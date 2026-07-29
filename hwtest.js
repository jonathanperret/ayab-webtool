import { SlipEncoderTransform, SlipDecoderTransform } from "./slip.js";

const AYAB_API = {
    reqStart: 0x01,
    cnfStart: 0xC1,
    reqLine: 0x82,
    cnfLine: 0x42,
    reqInfo: 0x03,
    cnfInfo: 0xC3,
    reqTest: 0x04,
    cnfTest: 0xC4,
    indState: 0x84,
    helpCmd: 0x25,
    sendCmd: 0x26,
    beepCmd: 0x27,
    setSingleCmd: 0x28,
    setAllCmd: 0x29,
    readEOLsensorsCmd: 0x2A,
    readEncodersCmd: 0x2B,
    autoReadCmd: 0x2C,
    autoTestCmd: 0x2D,
    stopCmd: 0x2E,
    quitCmd: 0x2F,
    reqInit: 0x05,
    cnfInit: 0xC5,
    testRes: 0xEE,
    debug: 0x9F
};

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function bytesToHex(bytes) {
    return Array.from(
        bytes,
        byte => byte.toString(16).padStart(2, "0")
    ).join(" ");
}

class TestClient {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
    }

    async connect() {
        const [knownPort] = await navigator.serial.getPorts();
        this.port = knownPort ?? await navigator.serial.requestPort();
        await this.port.open({ baudRate: 115200 });

        const slipDecoder = new TransformStream(new SlipDecoderTransform());
        this.readableStreamClosed = this.port.readable.pipeTo(slipDecoder.writable).catch(() => { });
        this.reader = slipDecoder.readable.getReader();

        const slipEncoder = new TransformStream(new SlipEncoderTransform());
        this.writableStreamClosed = slipEncoder.readable.pipeTo(this.port.writable).catch(() => { });
        this.writer = slipEncoder.writable.getWriter();

        console.log(`port opened`);
    }

    async read() {
        const { value, done } = await this.reader.read();
        // console.log("received", bytesToHex(value));
        return value;
    }

    async send(data) {
        // console.log(`sending: ${[...data].map(b => b.toString(16).padStart(2, '0')).join('')}`);
        await this.writer.write(data);
    }

    async waitFor(id, payload) {
        while (true) {
            const response = await this.read();
            if (response[0] == id &&
                (typeof (payload) === 'undefined' || payload.toString() == response.slice(1).toString()))
                return response;
            console.log(`response ${bytesToHex(response)}, expecting ${bytesToHex([id, ...(payload ?? [])])}`);
        }
    }

    async readSensors() {
        await this.send([AYAB_API.readEOLsensorsCmd]);
        let left, right;
        while (!(left && right)) {
            const res = await this.waitFor(AYAB_API.testRes);
            const text = new TextDecoder().decode(res.slice(1));
            let match;
            if (match = /EOL_([LR]): (\d+)/.exec(text)) {
                if (match[1] == 'L')
                    left = parseInt(match[2]);
                else
                    right = parseInt(match[2]);
            }
        }
        return { left, right };
    }

    async readEncoders() {
        await this.send([AYAB_API.readEncodersCmd]);
        let found = 0;
        const result = {};
        while (found < 3) {
            const res = await this.waitFor(AYAB_API.testRes);
            const text = new TextDecoder().decode(res.slice(1));
            let match;
            if (match = /LOW|HIGH/.exec(text)) {
                result[String.fromCharCode(65 + found)] = match[0] == 'HIGH';
                found++;
            }
        }
        return result;
    }

    async test() {
        try {
            await this.connect();


            let lastInitTime = 0;
            let initTries = 0;

            const readPromise = this.read();

            let infoResponse;
            for (let initTries = 0; initTries < 3; initTries++) {
                await this.send([AYAB_API.reqInfo]);

                console.log("waiting for reqInfo response");
                const initTry = initTries;
                infoResponse = await Promise.race([readPromise, delay(1000)]);
                if (infoResponse) {
                    break;
                }
            }

            console.log("infoResponse=", new TextDecoder().decode(infoResponse.slice(1)));

            const [msgId, apiVersion, major, minor, patch, ...suffix] = infoResponse;
            ui.result.innerText = `Firmware version ${major}.${minor}.${patch}${new TextDecoder().decode(new Uint8Array(suffix))} (API v${apiVersion})`

            await this.send([AYAB_API.reqInit, 0x00, 0xff]);
            await this.waitFor(AYAB_API.cnfInit);

            await this.send([AYAB_API.reqTest]);
            await this.waitFor(AYAB_API.cnfTest);

            while (true) {
                // const { A, B, C } = await this.readEncoders();
                // ui.encA.classList.toggle('is-light', !A);
                // ui.encB.classList.toggle('is-light', !B);
                // ui.encC.classList.toggle('is-light', !C);
                // const { left, right } = await this.readSensors();
                // ui.leftSensor.value = left;
                // ui.rightSensor.value = right;
                await this.send([AYAB_API.setAllCmd, 0x00, 0x01]);
                await delay(100);
                await this.send([AYAB_API.setAllCmd, 0, 0]);
                await delay(100);
            }

            console.log('TEST DONE');
        } finally {
            // Clean up
            await this.reader.cancel();
            await this.readableStreamClosed;
            await this.writer.close();
            await this.writableStreamClosed;
            await this.port.close();
        }
    }
}

const ui = {};

async function handleConnect() {
    const client = new TestClient();

    ui.connectBtn.disabled = true;
    await client.test();
}

document.addEventListener('DOMContentLoaded', () => {
    for (const id of ['connectBtn', 'result', 'leftSensor', 'rightSensor', 'encA', 'encB', 'encC'])
        ui[id] = document.getElementById(id);

    ui.connectBtn.addEventListener('click', handleConnect, false);
});
