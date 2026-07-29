const SLIP = {
    END: 0xC0,
    ESC: 0xDB,
    ESC_END: 0xDC,
    ESC_ESC: 0xDD
};

export class SlipDecoderTransform {
    constructor() {
        this.buffer = [];
        this.receiving = false;
        this.escaping = false;
    }

    transform(chunk, controller) {
        // console.log("decoding", chunk)
        for (let byte of chunk) {
            if (byte === SLIP.END) {
                if (this.receiving && this.buffer.length > 0) {
                    controller.enqueue(new Uint8Array(this.buffer));
                    this.receiving = false;
                } else {
                    this.receiving = true;
                }
                this.buffer = [];
                this.escaping = false;
            } else if (this.receiving) {
                if (this.escaping) {
                    if (byte === SLIP.ESC_END) {
                        this.buffer.push(SLIP.END);
                    } else if (byte === SLIP.ESC_ESC) {
                        this.buffer.push(SLIP.ESC);
                    }
                    this.escaping = false;
                } else if (byte === SLIP.ESC) {
                    this.escaping = true;
                } else {
                    this.buffer.push(byte);
                }
            }
        }
    }

    flush(controller) {
        if (this.receiving && this.buffer.length > 0) {
            controller.enqueue(new Uint8Array(this.buffer));
            this.receiving = false;
        }
    }
}

export class SlipEncoderTransform {
    transform(chunk, controller) {
        controller.enqueue(new Uint8Array([SLIP.END]));

        for (let byte of chunk) {
            if (byte === SLIP.END) {
                controller.enqueue(new Uint8Array([SLIP.ESC, SLIP.ESC_END]));
            } else if (byte === SLIP.ESC) {
                controller.enqueue(new Uint8Array([SLIP.ESC, SLIP.ESC_ESC]));
            } else {
                controller.enqueue(new Uint8Array([byte]));
            }
        }

        controller.enqueue(new Uint8Array([SLIP.END]));
    }
}