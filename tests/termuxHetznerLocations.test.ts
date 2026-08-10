import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type TermuxHetznerLocations = {
  schemaVersion: number;
  profile: string;
  computeDistribution: {
    frontendHardwareClass?: string;
    frontendRole: string;
    runtimeAuthority: string;
    termuxRole: string;
    macRole: string;
    forbidden: string[];
  };
  ssh: {
    hostName: string;
    user: string;
    recommendedTermuxCommand: string;
  };
  termuxPortForwarding: Record<string, { command: string; localUrlAfterForward: string }>;
  authorityRules: string[];
};

function loadLocations(): TermuxHetznerLocations {
  return JSON.parse(readFileSync("docs/termux-hetzner-mcp-locations.json", "utf8")) as TermuxHetznerLocations;
}

describe("Termux Hetzner MCP location contract", () => {
  it("declares weak frontend hardware as control-only and Hetzner as runtime authority", () => {
    const locations = loadLocations();

    expect(locations.schemaVersion).toBe(1);
    expect(locations.profile).toBe("hetzner-mcp-termux");
    expect(locations.computeDistribution.frontendHardwareClass).toBe("weak-lightweight");
    expect(locations.computeDistribution.frontendRole).toBe("control-surface-only");
    expect(locations.computeDistribution.termuxRole).toBe("mobile SSH control surface");
    expect(locations.computeDistribution.macRole).toBe("GUI/control/signing/light smoke checks");
    expect(locations.computeDistribution.runtimeAuthority).toBe("hetzner");
    expect(locations.authorityRules).toContain("Mac and Termux are control surfaces only.");
  });

  it("keeps MCP access private through SSH forwarding instead of public ports", () => {
    const locations = loadLocations();

    expect(locations.ssh.recommendedTermuxCommand).toContain("ssh -i ~/.ssh/id_ed25519_hetzner");
    expect(locations.ssh.hostName).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(locations.ssh.user).toBe("krille");
    expect(locations.computeDistribution.forbidden).toContain("Do not expose MCP ports publicly.");
    expect(locations.authorityRules).toContain("Do not expose MCP ports publicly; use SSH forwarding.");

    for (const forward of Object.values(locations.termuxPortForwarding)) {
      expect(forward.command).toContain("ssh -N -L");
      expect(forward.localUrlAfterForward).toMatch(/^http:\/\/127\.0\.0\.1:/);
    }
  });
});
