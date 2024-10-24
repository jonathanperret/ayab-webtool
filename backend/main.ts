import * as log from "jsr:@std/log";
import { router } from "jsr:@denosaurs/rutt";
import {
  BlobReader,
  BlobWriter,
  ZipReader,
} from "https://deno.land/x/zipjs/index.js";
log.setup({
  handlers: {
    default: new log.ConsoleHandler("DEBUG", {
      formatter: ({ levelName, msg, datetime }) => `${datetime.toISOString()} ${levelName} ${msg}`,
      useColors: false,
    }),
  },
});


const githubCache = await caches.open("github");
const githubCacheSuffix = ':v3';

const repoUrl = 'https://api.github.com/repos/AllYarnsAreBeautiful/ayab-firmware';

async function githubFetch(url) {
    const cacheKey = url + githubCacheSuffix;
    const cached = await githubCache.match(cacheKey);
    if(cached) {
        log.info(`found ${url} in cache`);
        return cached;
    }
    log.info(`fetching ${url}`);

    const res = await fetch(url, {
        headers: {
            "Authorization": `Bearer ${Deno.env.get("GITHUB_TOKEN")}`
        }
    });
    if(!res.ok) return res;

    await githubCache.put(cacheKey, res.clone());
    return res;
}

Deno.serve(router({
    "/hex": async (req: Request) => {
        const pullsResponse = await githubFetch(`${repoUrl}/pulls?per_page=100`);
        const pulls = await pullsResponse.json();
        const pullList = [];
        for(const pull of pulls) {
            pullList.push({
                number: pull.number,
                title: pull.title,
                html_url: pull.html_url,
                head_sha: pull.head.sha,
            });
        }

        const runsResponse = await githubFetch(`${repoUrl}/actions/runs?per_page=100`);
        const runs = await runsResponse.json();
        const hexs = [];
        for(const run of runs.workflow_runs.filter(r => r.name == "Archive Build")) {
            const head_sha = run.head_sha;
            const pull = pullList.find(pull => pull.head_sha == head_sha);
            if (pull) {
                const artifactsResponse = await githubFetch(run.artifacts_url);
                const artifacts = await artifactsResponse.json();
                const artifact = artifacts.artifacts[0];

                if (artifact && !artifact.expired) {
                    hexs.push({
                        download_url: new URL(`/hex/${artifact.id}`, req.url).href,
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
                "access-control-allow-origin": "*",
            }
        });
    },
    "/hex/:id": async (req: Request, _, { id }) => {
        const artifactResponse = await githubFetch(`${repoUrl}/actions/artifacts/${id}/zip`);
        const zipData = await artifactResponse.blob();
        const zipReader = new ZipReader(new BlobReader(zipData));
        const zipEntries = await zipReader.getEntries();

        const hexEntry = zipEntries.find(entry => /\.hex$/.test(entry.filename));

        if (!hexEntry) {
            return new Response(null, { status: 404 });
        }

        const hexData = await hexEntry.getData(new BlobWriter());

        console.log(hexData);

        return new Response(hexData, {
            headers: {
                "access-control-allow-origin": "*",
                "content-type": "text/plain",
                "content-disposition": `attachment; filename=${hexEntry.filename}`,
            }
        });
    }
}));