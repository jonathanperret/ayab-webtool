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

    let avrgirl = new AvrgirlArduino({
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
                <input type="radio" name="firmware" class="mr-2" value="${hex.download_url}">
                <div class="is-flex is-flex-direction-column">
                    <span><a href="${hex.pull_url}" target="_blank" class="mr-1">#${hex.pull_number}</a>${htmlEscape(hex.pull_title)}</span>
                    <span class="is-size-7 ml-1">built on ${new Date(hex.created_at).toLocaleString()}</span>
                </div>
            </label>            
        `).join('')}
    `;

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
            hexUrl = ev.target.value;
            uploadBtn.disabled = false;
        }
    });

    getFirmwares();
});
