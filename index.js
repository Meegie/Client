require('dotenv').config();

const { log } = console;

// console.clear();

const os = require('os');
const fs = require('fs');
const Docker = require('dockerode');

let dockerPath = '/var/run/docker.sock';

log(`> Starting Meegie client...`);

// Check ram
log(`> Checking resources...`);
const clientRAM = Math.floor(os.totalmem()/1024/1024);
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
const docker = new Docker({socketPath: dockerPath});
log(` | Created docker client!`);

log(`> Connecting to API...`);
main();

let isWorking = false;

async function main() {
    const ok = await fetch(`${process.env.API}/connect?code=${code}&cpu=${cpu}&cpucount=${clientCPU}&ram=${clientRAM}`);

    if (ok.ok == false) {
        log(` | Failed to connect: ${(await ok.json()).error}`);
    }

    log(` |  Connected!`);

    setInterval(() => {
        if (isWorking == false) getJob();
    }, 1000*60*5);
    getJob();
}

async function ping() {
    console.log(`> Sending heartbeat...`);
    await fetch(`${process.env.API}/ping?code=${code}`);
}

setInterval(() => {
    if (isWorking == true) ping();
}, 1000*60*1);
setInterval(() => {
    if (isWorking == false) ping();
}, 1000*60*5);

async function getJob() {
    log(`> Getting job...`);

    var job = await fetch(`${process.env.API}/jobs/get?code=${code}`).then(r => r.json());

    if (job.found == false) {
        return log(` | No job found :(`);
    }

    console.log(job);
}

async function pull(img) {
    //followProgress(stream, onFinished, [onProgress])

    log(`> Pulling ${img}`);

    docker.pull(img, function(err, stream) {
        //...
        docker.modem.followProgress(stream, onFinished, onProgress);
    
        function onFinished(err, output) {
        //output is an array with output json parsed objects
            log(` | Pull ${img} finished!`, err, output);
        //...
        }
        function onProgress(event) {
        //...
            log(` | Pull progress: `, event)
        }
    });
}