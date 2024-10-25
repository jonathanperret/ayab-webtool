let uploadBtn;
let result;
let progressBar;
let firmwaresDiv;
let hexUrl;

async function handleFlash(e) {
    e.preventDefault();

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

    return s.replace(/[<>"&]/g, escapeChar)
}

async function getFirmwares() {
    const hexsResponse = await fetch("https://ayab-firmware-binaries.deno.dev/hex");
    const hexs = await hexsResponse.json();

    firmwaresDiv.innerHTML = `
        <p class="panel-heading">Pick a PR to flash its firmware</p>
        ${hexs.map(hex => `
            <label class="panel-block radio">
                <input type="radio" name="firmware" class="mr-2" data-url="${hex.download_url}" data-pr="${hex.pull_number}">
                <div class="is-flex is-flex-direction-column">
                    <span><a href="${hex.pull_url}" target="_blank" class="mr-1">#${hex.pull_number}</a>${htmlEscape(hex.pull_title)}</span>
                    <span class="is-size-7 ml-1">built on ${new Date(hex.created_at).toLocaleString()}</span>
                </div>
            </label>            
        `).join('')}
    `;

    selectFirmwareFromURL();
}

function selectFirmwareFromURL() {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const pr = hashParams?.get('pr');

    if (pr) {
        const prInput = firmwaresDiv.querySelector(`input[data-pr="${pr}"]`);
        prInput?.click();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    uploadBtn = document.getElementById('uploadBtn');
    result = document.getElementById('result');
    progressBar = document.getElementById('progress-bar');
    firmwaresDiv = document.getElementById("firmwares");

    if (!navigator.serial) {
        firmwaresDiv.innerHTML = `
            <article class="message is-danger">
            <div class="message-header">
            <p>Unsupported browser</p>
            </div>
            <div class="message-body">
            Darn, it looks like your browser does not support the WebSerial API.
            <br>
            Please try again with Google Chrome or Microsoft Edge.
            </div>
            </article>
        `;
        return;
    }

    uploadBtn.addEventListener('click', handleFlash, false);

    firmwaresDiv.addEventListener('click', (ev) => {
        if (ev.target.tagName === 'INPUT') {
            const input = ev.target;
            hexUrl = input.dataset.url;
            uploadBtn.disabled = false;
            window.location.hash = `#pr=${input.dataset.pr}`;
        }
    });

    getFirmwares();
});
