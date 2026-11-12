import { describe, expect, it } from "vitest";
import { PortHolders } from "./port-holders.ts";

describe("PortHolders.hint", () => {
    it("names a holder leeway can't see, with kill and move as fixes, when the port's listener has no pid or none is found", () => {
        const hint = PortHolders.hint({ PORT_WEB: 21000, PORT_API: 21001 }, [{ port: 21000, pid: null }], []);

        expect(hint).toBe(
            "leeway: 21000 (PORT_WEB) is in use by a process leeway can't see; if it's this folder's, leeway kill; if not, leeway move\n" +
                "leeway: 21001 (PORT_API) is in use by a process leeway can't see; if it's this folder's, leeway kill; if not, leeway move\n",
        );
    });
});
