require('dotenv').config();

const { log } = console;

// console.clear();

const os = require('os');
const fs = require('fs');
const Docker = require('dockerode');
const Stream = require('stream'); 

let dockerPath = '/var/run/docker.sock';

log(`> Starting Meegie client...`);

// Check ram
log(`> Checking resources...`);
const clientRAM = Math.floor(os.totalmem() / 1024 / 1024);
const clientCPU = os.cpus().length;
log(` | Client RAM: ${clientRAM} MB`);
log(` | Client CPU: ${clientCPU} vCPU`);

if (process.arch == 'x64') {
    cpu = 'x86';
} else if (process.arch == 'arm' || process.arch == 'arm64') {
    cpu = 'arm';
} else {
    log(` | Unsupported cpu ${process.arch}`);
    process.exit(1);
}
log(` | Client arch: ${cpu}`);

// Get code
log(`> Getting code...`);
const code = process.env.CODE;
log(` | Connect code: ${code}`);

// Check docker
log(`> Checking if docker is installed...`);
if (!fs.existsSync(dockerPath)) {
    log(` | Docker not found! ${dockerPath}`);
    process.exit(1);
}
log(` | Found docker at ${dockerPath}`);
const docker = new Docker({ socketPath: dockerPath });
log(` | Created docker client!`);

log(`> Connecting to API...`);
main();

let isWorking = false;

async function main() {
    const ok = await fetch(`${process.env.API}/connect?code=${code}&cpu=${cpu}&cpucount=${clientCPU}&ram=${clientRAM}`);

    if (ok.ok == false) {
        log(` | Failed to connect: ${(await ok.json()).error}`);
        process.exit(1);
    }

    log(` |  Connected!`);

    setInterval(() => {
        if (isWorking == false) getJob();
    }, 1000 * 60 * 5);
    getJob();

    ping();
}

async function ping() {
    console.log(`> Sending heartbeat...`);
    await fetch(`${process.env.API}/ping?code=${code}`);
}

setInterval(() => {
    if (isWorking == true) ping();
}, 1000 * 60 * 1);
setInterval(() => {
    if (isWorking == false) ping();
}, 1000 * 60 * 5);

async function getJob() {
    log(`> Getting job...`);

    var job = await fetch(`${process.env.API}/jobs/get?code=${code}`).then(r => r.json());

    if (job.found == false) {
        return log(` | No job found :(`);
    }

    console.log(` | Found job ${job.jobID}`);

    const { image, ramRequired, cpuRequired, timeLimit } = job;

    try {
        await pull(image);

        log(` | Image pulled!`);

        const output = new Stream.Writable({
            write: async (data) => {
                data = String(data);
                try {
                   var a = await fetch(`${process.env.API}/jobs/log?code=${code}`, {
                        method: 'POST',
                        headers: {
                            'content-type': 'application/json'
                        },
                        body: JSON.stringify({
                            message: data
                        })
                    }).then(r => r.json());
                    console.log(a);
                } catch(e) {
                    console.log(`> Failed to send log! ${String(e)}`, e);
                    process.exit(1);
                }
            }
        });

        var newContainer = await docker.run(image, null, output, {
            HostConfig: {
                AutoRemove: true
            }
        });

        output.on('data', (d) => {
            console.log(` | Output: ${String(d)}`);
        });

        var result = newContainer[0];
        console.log(result);

        var isOk = true;
        if (result.StatusCode != 0) isOk = false;

        await fetch(`${process.env.API}/jobs/finish?code=${code}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                ok: isOk,
                exitCode: result.StatusCode,
                error: `Check logs ^`
            })
        }).then(r => r.json());
    } catch (e) {
        await fetch(`${process.env.API}/jobs/finish?code=${code}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                ok: false,
                exitCode: 1,
                error: String(e)
            })
        }).then(r => r.json());

        log(` | Job failed: ${String(e)}`);
    }

}

async function pull(img) {
    //followProgress(stream, onFinished, [onProgress])

    log(`> Pulling ${img}`);

    return new Promise((resolve, reject) => {

        docker.pull(img, function (err, stream) {
            if (err) return reject(err);
            //...
            try {
                docker.modem.followProgress(stream, onFinished, onProgress);

                function onFinished(err, output) {
                    //output is an array with output json parsed objects
                    log(` | Pull ${img} finished!`, err);
                    if (err) return reject(err);

                    resolve();
                    //...
                }
                function onProgress(event) {
                    //...
                    log(` | Pull progress: ${event.status}`)
                }
            } catch (e) {
                reject(e);
            }
        });
    });
}