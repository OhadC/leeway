import type { ChildProcess } from "node:child_process";
import net from "node:net";
import { ProcessTree } from "../src/os/process-tree.ts";

export class Listeners {
    static readonly serverScript = 'require("node:net").createServer().listen(Number(process.argv[1]), () => console.log("listening"));';

    static readonly watcherScript = `import { spawn } from "node:child_process";
const server = ${JSON.stringify(Listeners.serverScript)};
const start = () => spawn(process.execPath, ["-e", server, process.env.PORT_WEB], { stdio: "inherit" }).on("exit", start);
start();
`;

    static accepts(port: number | undefined): Promise<boolean> {
        return new Promise(resolve => {
            const socket = net.connect({ host: "127.0.0.1", port: port ?? 0 }, () => {
                socket.destroy();
                resolve(true);
            });

            socket.once("error", () => resolve(false));
        });
    }

    static async stopTree(child: ChildProcess): Promise<void> {
        if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
            return;
        }

        const exited = new Promise(resolve => child.once("exit", resolve));

        ProcessTree.killTreeQuietly(child.pid);
        await exited;
    }
}
