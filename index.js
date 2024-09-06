const { log } = console;

console.clear();

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

// Get code
log(`> Getting code...`);
const code = process.argv[2];
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

async function main() {
    const ok = await fetch(`https://clients.meegie.net/connect?code=${code}`);

    console.log(ok.ok, await ok.json());
}