import * as log from 'jsr:@std/log';
import { router, type Routes } from 'jsr:@denosaurs/rutt';
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

const repoUrl =
  'https://api.github.com/repos/AllYarnsAreBeautiful/ayab-firmware';

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

const routes: Routes = {
  '/pulls': async (req: Request) => {
    const [pullsResponse, runsResponse] = await Promise.all([
      githubFetch(
        `${repoUrl}/pulls?per_page=100`,
      ),
      githubFetch(
        `${repoUrl}/actions/runs?per_page=100`,
      ),
    ]);

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
            download_url: new URL(`/pull-hex/${artifact.id}`, req.url).href,
            pull_number: pull.number,
            pull_url: pull.html_url,
            pull_title: pull.title,
            created_at: artifact.created_at,
            size_in_bytes: artifact.size_in_bytes,
          });
        }
      }
    }

    return Response.json(hexs, {
      headers: {
        'access-control-allow-origin': '*',
      },
    });
  },
  '/releases': async (req: Request) => {
    const releasesResponse = await githubFetch(
      `${repoUrl}/releases?per_page=100`,
    );
    if (!releasesResponse.ok) {
      return new Response(null, { status: releasesResponse.status });
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
      const asset = release.assets.find((a) => /\.hex$/.test(a.name));
      if (asset) {
        hexs.push({
          download_url: new URL(
            `/release-hex/${asset.id}/${
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

    return Response.json(hexs, {
      headers: {
        'access-control-allow-origin': '*',
      },
    });
  },
  '/release-hex/:id/:filename': async (
    _req: Request,
    _,
    { id, filename },
  ) => {
    if (!/^\d+$/.test(id)) {
      return new Response(null, { status: 400 });
    }
    const assetResponse = await githubFetch(
      `${repoUrl}/releases/assets/${id}`,
      { useCache: true, headers: { Accept: 'application/octet-stream' } },
    );
    if (!assetResponse.ok) {
      return new Response(null, { status: assetResponse.status });
    }

    return new Response(assetResponse.body, {
      headers: {
        'access-control-allow-origin': '*',
        'content-type': 'text/plain',
        'content-disposition': `attachment; filename=${
          filename.replace(/[^\w.-]/g, '_')
        }`,
      },
    });
  },
  '/pull-hex/:id': async (_req: Request, _, { id }) => {
    const artifactResponse = await githubFetch(
      `${repoUrl}/actions/artifacts/${id}/zip`,
      { useCache: false },
    );
    const zipData = await artifactResponse.blob();
    const zipReader = new ZipReader(new BlobReader(zipData));
    const zipEntries = await zipReader.getEntries();

    const hexEntry = zipEntries.find((entry) => /\.hex$/.test(entry.filename));

    if (!hexEntry) {
      return new Response(null, { status: 404 });
    }

    const hexData = await hexEntry.getData?.(new BlobWriter());

    return new Response(hexData, {
      headers: {
        'access-control-allow-origin': '*',
        'content-type': 'text/plain',
        'content-disposition': `attachment; filename=${hexEntry.filename}`,
      },
    });
  },
};

Deno.serve(
  router({
    ...routes,
    // Legacy names, kept until the deployed frontend uses the new ones.
    '/hex': routes['/pulls'],
    '/hex/:id': routes['/pull-hex/:id'],
  }),
);
