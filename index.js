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

let cpuAvailable = 0;
let ramAvailable = 0;

async function main() {
    const ok = await fetch(`${process.env.API}/connect?code=${code}&cpu=${cpu}&cpucount=${clientCPU}&ram=${clientRAM}`);

    if (ok.ok == false) {
        log(` | Failed to connect: ${(await ok.json()).error}`);
        process.exit(1);
    }

    const connectBody = await ok.json();
    cpuAvailable = connectBody.cpu;
    ramAvailable = connectBody.ram;

    log(` |  Connected!`);

    setInterval(() => {
        try {
            getJob();
        } catch (e) {
            console.log(`Failed to get job!`, e);
        }
    }, 1000 * 60 * 1);
    try {
        getJob();
    } catch (e) {
        console.log(`Failed to get job!`, e);
    }

    ping();
}

async function ping() {
    console.log(`> Sending heartbeat...`);
    await fetch(`${process.env.API}/ping?code=${code}`);
}

setInterval(() => {
    ping();
}, 1000 * 60 * 1);

async function getJob() {
    try {
        log(`> Getting job...`);

        console.log(`> available - ${cpuAvailable} vCPU - ${ramAvailable} MB`);

        var jobs = await fetch(`${process.env.API}/jobs/get?code=${code}&cpu=${cpuAvailable}&ram=${ramAvailable}`).then(r => r.json());

        if (jobs.found == false) {
            return log(` | No job found :(`);
        }

        console.log(jobs);

        for (let i = 0; i < jobs.jobs.length; i++) {
            job = jobs.jobs[i];

            console.log(` | Found job ${job.ID}`);

            processJob(job).then(() => {
                log(`> Job finished: ${job.ID}`);
            }).catch(e => {
                errorJob(job.ID, e);
            });

        }
    } catch (e) {
        console.log('failed getting job...', e)
    }
}

async function errorJob(id, error) {
    try {
        await fetch(`${process.env.API}/jobs/finish?code=${code}&id=${id}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                ok: false,
                exitCode: 1,
                error: String(error)
            })
        }).then(r => r.json());

        log(` | Job failed: ${String(error)}`);
    } catch (e) {
        log(` | Failed to send error! ${String(e)}`, e);
    }
}

async function processJob(job) {

    const { image, ramRequired, cpuRequired, timeLimit, ID } = job;

    cpuAvailable = cpuAvailable - cpuRequired;
    ramAvailable = ramAvailable - ramRequired;

    try {
        await pull(image);

        log(` | Image pulled!`);

        var outputLog;
        outputLog = '';

        const output = new Stream.Writable({
            write: (data) => {
                data = String(data);
                outputLog += data;
                return data;
            }
        });

        // Start the container
        var container = await docker.createContainer({
            name: `meegie-${ID}`,
            Image: image,
            HostConfig: {
                AutoRemove: true,
                Memory: ramRequired * 1_048_576,
                CpuQuota: cpuRequired * 100_000,
                CPUPeriod: 100_000,
                CpuShares: 1024
            }
        });

        // Set a timeout to kill the container if it exceeds the time limit
        const containerTimeout = setTimeout(async () => {
            log(` | Time limit of ${timeLimit} seconds reached, stopping container...`);
            try {
                await container.stop();
            } catch (e) {
                console.log(`> Failed to stop container! ${String(e)}`, e);
                // process.exit(1);
            }
            cpuAvailable = cpuAvailable + cpuRequired;
            ramAvailable = ramAvailable + ramRequired;
            errorJob(ID, `Container exceeded time limit of ${timeLimit} seconds`);
        }, timeLimit * 1000);

        // Start the container and run the job
        await container.start();

        log(` | Container started!`);

        async function sendLog() {
            if (outputLog.length < 1) return; // No new output, skip sending
            var copy = outputLog;
            outputLog = ''; // Clear the log after sending 
            try {
                var logRes = await fetch(`${process.env.API}/jobs/log?code=${code}&id=${ID}`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: copy
                    })
                }).then(r => r.json());
                console.log(` | Logged: ${logRes.ID}`);
            } catch (e) {
                console.log(`> Failed to send log! ${String(e)}`, e);
                // process.exit(1);
            }
        }

        var logInt = setInterval(async () => {
            // console.log(outputLog);
            sendLog();
        }, 3000);

        const containerStream = await container.attach({ stream: true, stdout: true, stderr: true });
        containerStream.pipe(output);

        containerStream.on('data', (d) => {
            outputLog += String(d);
        });

        // Wait for the container to finish
        const exitCode = await container.wait();

        clearTimeout(containerTimeout); // Clear the timeout if the container finishes within the time limit
        clearInterval(logInt); // Clear the timeout if the container finishes

        await sendLog();

        var isOk = true;
        if (exitCode.StatusCode != 0) isOk = false;

        await fetch(`${process.env.API}/jobs/finish?code=${code}&id=${ID}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                ok: isOk,
                exitCode: exitCode.StatusCode,
                error: `Check logs ^`
            })
        }).then(r => r.json());

        cpuAvailable = cpuAvailable + cpuRequired;
        ramAvailable = ramAvailable + ramRequired;

        console.log(` | Job ${job.ID} finished!`);
    } catch (e) {
        errorJob(job.ID, String(e));
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