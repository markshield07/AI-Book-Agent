// Prints the addresses other devices on the home network can use to open the app.
// Run by `npm start` and `npm run dev` just before the server starts.
import os from "node:os";

const port = process.argv[2] || "3100";
const lan = [];
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  for (const a of addrs ?? []) {
    if (a.family !== "IPv4" && a.family !== 4) continue;
    if (a.internal || a.address.startsWith("169.254.")) continue; // loopback, no-network fallback
    if (/vethernet|wsl|docker|virtualbox|vmware|hyper-v|vbox|utun|bridge/i.test(name)) continue;
    lan.push(a.address);
  }
}

console.log("");
console.log("  The Editorial Studio");
console.log(`  On this computer:    http://localhost:${port}`);
if (lan.length === 0) console.log("  Other devices:       (no network connection found)");
for (const ip of lan) console.log(`  Other devices:       http://${ip}:${port}`);
console.log("");
