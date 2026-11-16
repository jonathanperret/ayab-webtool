import * as log from 'jsr:@std/log';
import { type MatchHandler, router } from 'jsr:@denosaurs/rutt';
import { BlobReader, BlobWriter, ZipReader } from 'jsr:@zip-js/zip-js';

log.setup({
  handlers: {
    default: new log.ConsoleHandler('DEBUG', {
      formatter: ({ levelName, msg, datetime }) =>
        `${datetime.toISOString()} ${levelName} ${msg}`,
      useColors: false,
    }),
  },
});

const githubCache = await caches.open('github');
const githubCacheSuffix = ':v5';

const defaultRepo = { owner: 'AllYarnsAreBeautiful', repo: 'ayab-firmware' };

// Firmware repositories this backend serves (matched case-insensitively).
const allowedRepos = [
  'AllYarnsAreBeautiful/ayab-firmware',
  'MathKnitting/silverreed-firmware',
  'jonathanperret/ayab-firmware',
  'jpcornil-git/ayabAsync-firmware',
];

const corsHeaders = { 'access-control-allow-origin': '*' };

async function githubFetch(
  url: string,
  options: { useCache?: boolean; headers?: HeadersInit } = {},
) {
  const cacheKey = url + githubCacheSuffix;
  const cached = options.useCache && (await githubCache.match(cacheKey));
  if (cached) {
    log.info(`found ${url} in cache`);
    return cached;
  }
  log.info(`fetching ${url}`);

  const fetchOptions: RequestInit = {
    headers: {
      ...options.headers,
      Authorization: `Bearer ${Deno.env.get('GITHUB_TOKEN')}`,
    },
    redirect: 'manual',
  };

  let res = await fetch(url, fetchOptions);

  if (res.status >= 300 && res.status < 400) {
    const newLocation: string = res.headers.get('location')!;
    console.log(`following redirect to ${newLocation}`);
    res = await fetch(newLocation, {});
  }

  if (!res.ok) return res;

  if (options.useCache) {
    await githubCache.put(cacheKey, res.clone());
  }
  return res;
}

type RepoContext = {
  // GitHub API URL of the repository
  repoUrl: string;
  // Path prefix of this backend's routes for the repository
  basePath: string;
};

type RepoHandler = (
  req: Request,
  repo: RepoContext,
  params: Record<string, string>,
) => Promise<Response>;

// Wraps a handler for routes under /repos/:owner/:repo, refusing repositories
// that aren't in allowedRepos.
function repoRoute(handler: RepoHandler): MatchHandler {
  return (req, _, params) => {
    const requested = `${params.owner}/${params.repo}`.toLowerCase();
    const fullName = allowedRepos.find((name) =>
      name.toLowerCase() === requested
    );
    if (!fullName) {
      return new Response(null, { status: 404, headers: corsHeaders });
    }

    return handler(
      req,
      {
        repoUrl: `https://api.github.com/repos/${fullName}`,
        basePath: `/repos/${fullName}`,
      },
      params,
    );
  };
}

const pulls: RepoHandler = async (req, { repoUrl, basePath }) => {
  const [pullsResponse, runsResponse] = await Promise.all([
    githubFetch(
      `${repoUrl}/pulls?per_page=100`,
    ),
    githubFetch(
      `${repoUrl}/actions/runs?per_page=100`,
    ),
  ]);

  if (!pullsResponse.ok || !runsResponse.ok) {
    return new Response(null, { status: 502, headers: corsHeaders });
  }

  const pulls: [{
    number: number;
    title: string;
    html_url: string;
    head: { sha: string };
  }] = await pullsResponse.json();
  const pullList = pulls.map((pull) => ({
    number: pull.number,
    title: pull.title,
    html_url: pull.html_url,
    head_sha: pull.head.sha,
  }));

  const runs: {
    workflow_runs: [
      {
        name: string;
        conclusion: string;
        head_sha: string;
        artifacts_url: string;
      },
    ];
  } = await runsResponse.json();
  const hexs = [];
  for (
    const run of runs.workflow_runs.filter(
      (r) => r.name == 'Archive Build' && r.conclusion == 'success',
    )
  ) {
    const head_sha = run.head_sha;
    const pull = pullList.find((pull) => pull.head_sha == head_sha);
    if (pull) {
      const artifactsResponse = await githubFetch(
        run.artifacts_url,
        {
          useCache: true,
        },
      );
      const artifacts = await artifactsResponse.json();
      const artifact = artifacts.artifacts[0];

      if (artifact && !artifact.expired) {
        hexs.push({
          download_url:
            new URL(`${basePath}/pull-hex/${artifact.id}`, req.url).href,
          pull_number: pull.number,
          pull_url: pull.html_url,
          pull_title: pull.title,
          created_at: artifact.created_at,
          size_in_bytes: artifact.size_in_bytes,
        });
      }
    }
  }

  return Response.json(hexs, { headers: corsHeaders });
};

const releases: RepoHandler = async (req, { repoUrl, basePath }) => {
  const releasesResponse = await githubFetch(
    `${repoUrl}/releases?per_page=100`,
  );
  if (!releasesResponse.ok) {
    return new Response(null, { status: 502, headers: corsHeaders });
  }

  const releases: {
    tag_name: string;
    name: string | null;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
    published_at: string;
    assets: { id: number; name: string; size: number }[];
  }[] = await releasesResponse.json();

  const hexs = [];
  for (const release of releases.filter((r) => !r.draft)) {
    // Releases may hold builds for several boards: prefer the Uno one, since
    // that's what the frontend flashes.
    const hexAssets = release.assets.filter((a) => /\.hex$/.test(a.name));
    const asset = hexAssets.find((a) => /uno/i.test(a.name)) ?? hexAssets[0];
    if (asset) {
      hexs.push({
        download_url: new URL(
          `${basePath}/release-hex/${asset.id}/${
            encodeURIComponent(
              asset.name.replace(/\.hex$/, `-${release.tag_name}.hex`),
            )
          }`,
          req.url,
        ).href,
        tag_name: release.tag_name,
        name: release.name || release.tag_name,
        release_url: release.html_url,
        prerelease: release.prerelease,
        published_at: release.published_at,
        size_in_bytes: asset.size,
      });
    }
  }

  return Response.json(hexs, { headers: corsHeaders });
};

const releaseHex: RepoHandler = async (_req, { repoUrl }, { id, filename }) => {
  if (!/^\d+$/.test(id)) {
    return new Response(null, { status: 400, headers: corsHeaders });
  }
  const assetResponse = await githubFetch(
    `${repoUrl}/releases/assets/${id}`,
    { useCache: true, headers: { Accept: 'application/octet-stream' } },
  );
  if (!assetResponse.ok) {
    return new Response(null, {
      status: assetResponse.status,
      headers: corsHeaders,
    });
  }

  return new Response(assetResponse.body, {
    headers: {
      ...corsHeaders,
      'content-type': 'text/plain',
      'content-disposition': `attachment; filename=${
        filename.replace(/[^\w.-]/g, '_')
      }`,
    },
  });
};

const pullHex: RepoHandler = async (_req, { repoUrl }, { id }) => {
  if (!/^\d+$/.test(id)) {
    return new Response(null, { status: 400, headers: corsHeaders });
  }
  const artifactResponse = await githubFetch(
    `${repoUrl}/actions/artifacts/${id}/zip`,
    { useCache: false },
  );
  if (!artifactResponse.ok) {
    return new Response(null, {
      status: artifactResponse.status,
      headers: corsHeaders,
    });
  }
  const zipData = await artifactResponse.blob();
  const zipReader = new ZipReader(new BlobReader(zipData));
  const zipEntries = await zipReader.getEntries();

  const hexEntry = zipEntries.find((entry) => /\.hex$/.test(entry.filename));

  if (!hexEntry) {
    return new Response(null, { status: 404, headers: corsHeaders });
  }

  const hexData = await hexEntry.getData?.(new BlobWriter());

  return new Response(hexData, {
    headers: {
      ...corsHeaders,
      'content-type': 'text/plain',
      'content-disposition': `attachment; filename=${hexEntry.filename}`,
    },
  });
};

// Serves a repo route for the default repository, for the legacy routes.
function defaultRepoRoute(handler: RepoHandler): MatchHandler {
  const route = repoRoute(handler);
  return (req, info, params) => route(req, info, { ...params, ...defaultRepo });
}

Deno.serve(
  router({
    '/repos/:owner/:repo/pulls': repoRoute(pulls),
    '/repos/:owner/:repo/pull-hex/:id': repoRoute(pullHex),
    '/repos/:owner/:repo/releases': repoRoute(releases),
    '/repos/:owner/:repo/release-hex/:id/:filename': repoRoute(releaseHex),
    // Legacy routes for ayab-firmware, kept until the deployed frontend uses
    // the ones above.
    '/hex': defaultRepoRoute(pulls),
    '/hex/:id': defaultRepoRoute(pullHex),
  }),
);
