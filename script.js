let uploadBtn;
let downloadBtn;
let result;
let progressBar;
let firmwaresDiv;
let webserialWarning;
let hexUrl;

async function handleFlash(e) {
    e.preventDefault();

    progressBar.style.display = '';
    result.style.display = '';

    progressBar.classList.remove("is-danger");
    progressBar.removeAttribute("value");

    result.textContent = "downloading firmware from GitHub";

    const hexResponse = await fetch(hexUrl);
    const hexData = await hexResponse.arrayBuffer();

    result.textContent = "selecting serial port and flashing";

    const board = 'uno';

    const avrgirl = new AvrgirlArduino({
        board: board,
        debug: true
    });

    avrgirl.flash(hexData, (error) => {
        progressBar.value = 100;
        if (error) {
            progressBar.classList.add("is-danger");
            result.textContent = error.message;
            console.error(error);
        } else {
            result.textContent = "Firmware flashing done. You can now test this firmware with the AYAB desktop app. Happy knitting!";
        }
    });
}

function htmlEscape(s) {
    function escapeChar(a) {
        return ESC[a] || a
    }

    const ESC = {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        '&': '&amp;'
    }

    return String(s).replace(/[<>"&]/g, escapeChar)
}

const backendUrl = ['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://localhost:8000'
    : 'https://ayab-webtool.jonathanperret.deno.net';

async function fetchJson(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error(`failed to fetch ${url}`, error);
        return [];
    }
}

// Only offer releases published on or after the 1.0.0 release date.
const minimumReleaseDate = Date.parse('2025-02-24T00:00:00Z');

async function getFirmwares() {
    const [allReleases, hexs] = await Promise.all([
        fetchJson(`${backendUrl}/releases`),
        fetchJson(`${backendUrl}/pulls`),
    ]);

    const releases = allReleases.filter((release) => Date.parse(release.published_at) >= minimumReleaseDate);

    const latestHexs = [...hexs]
        .sort((a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0))
        .filter((hex, index, allHexs) => allHexs.findIndex((candidate) => candidate.pull_number === hex.pull_number) === index);

    firmwaresDiv.innerHTML = `
        <p class="panel-heading">Pick a firmware to flash</p>
        <p class="panel-block has-background-light">Releases</p>
        ${releases.length ? releases.map(release => `
            <label class="panel-block radio">
                <input type="radio" name="firmware" class="mr-2" data-url="${htmlEscape(release.download_url)}" data-hash="release=${htmlEscape(encodeURIComponent(release.tag_name))}">
                <div class="is-flex is-flex-direction-column">
                    <span><a href="${htmlEscape(release.release_url)}" target="_blank" class="mr-1">${htmlEscape(release.name)}</a>${release.prerelease ? '<span class="tag is-warning is-light ml-1">pre-release</span>' : ''}</span>
                    <span class="is-size-7 ml-1">published on ${new Date(release.published_at).toLocaleString()}</span>
                </div>
            </label>
        `).join('') : '<p class="panel-block">No releases found.</p>'}
        <p class="panel-block has-background-light">Pull requests</p>
        ${latestHexs.length ? latestHexs.map(hex => `
            <label class="panel-block radio">
                <input type="radio" name="firmware" class="mr-2" data-url="${htmlEscape(hex.download_url)}" data-hash="pr=${hex.pull_number}">
                <div class="is-flex is-flex-direction-column">
                    <span><a href="${htmlEscape(hex.pull_url)}" target="_blank" class="mr-1">#${hex.pull_number}</a>${htmlEscape(hex.pull_title)}</span>
                    <span class="is-size-7 ml-1">built on ${new Date(hex.created_at).toLocaleString()}</span>
                </div>
            </label>
        `).join('') : '<p class="panel-block">No PR builds found.</p>'}
    `;

    selectFirmwareFromURL();
}

function selectFirmwareFromURL() {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));

    for (const key of ['release', 'pr']) {
        const value = hashParams.get(key);
        if (value) {
            const hash = new URLSearchParams({ [key]: value }).toString();
            const input = [...firmwaresDiv.querySelectorAll('input[data-hash]')]
                .find((candidate) => candidate.dataset.hash === hash);
            input?.click();
            return;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    uploadBtn = document.getElementById('uploadBtn');
    downloadBtn = document.getElementById('downloadBtn');
    result = document.getElementById('result');
    progressBar = document.getElementById('progress-bar');
    firmwaresDiv = document.getElementById("firmwares");
    webserialWarning = document.getElementById("webserial-warning");

    if (!navigator.serial) {
        webserialWarning.style.display = '';
        uploadBtn.style.display = 'none';
        progressBar.style.display = 'none';
        result.style.display = 'none';
    } else {
        uploadBtn.addEventListener('click', handleFlash, false);
    }

    firmwaresDiv.addEventListener('click', (ev) => {
        if (ev.target.tagName === 'INPUT') {
            const input = ev.target;
            hexUrl = input.dataset.url;
            uploadBtn.disabled = false;
            downloadBtn.removeAttribute('disabled');
            downloadBtn.href = hexUrl;
            window.location.hash = `#${input.dataset.hash}`;
        }
    });

    getFirmwares();
});
