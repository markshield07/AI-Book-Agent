import { describe, it, expect } from "vitest";

describe("Windows npm shim parsing", () => {
  it("finds the cli.js an npm .cmd shim points at", () => {
    const shim = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';
    expect(shim.match(/%dp0%\\([^"%\r\n]+\.(?:js|exe))/i)?.[1]).toBe("node_modules\\@anthropic-ai\\claude-code\\cli.js");
    const exeShim = '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
    expect(exeShim.match(/%dp0%\\([^"%\r\n]+\.(?:js|exe))/i)?.[1]).toBe("node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe");
  });
});
