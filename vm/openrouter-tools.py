"""One MCP request on the bot's existing desktop. Model credentials stay on the Mac."""
import asyncio
import base64
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main(request):
    backend = request.get("backend", "screen")
    display = str(request["display"])
    if backend == "shell":
        proc = await asyncio.create_subprocess_shell(
            request["arguments"]["command"], cwd="/workspace",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "DISPLAY": f":{display}"}, start_new_session=True,
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
        except asyncio.TimeoutError:
            import signal
            os.killpg(proc.pid, signal.SIGKILL)
            await proc.wait()
            return {"isError": True, "content": [{"type": "text", "text": "Command exceeded 60 seconds and was stopped."}]}
        return {"isError": proc.returncode != 0, "content": [{"type": "text", "text": out.decode("utf-8", "replace")[:20000]}]}

    params = StdioServerParameters(
        command="/usr/bin/node" if backend == "browser" else "/opt/bops/venv/bin/python",
        args=["/opt/bops/pw/node_modules/@playwright/mcp/cli.js", "--cdp-endpoint", f"http://127.0.0.1:{9200 + int(display)}"]
        if backend == "browser" else ["/opt/bops/screen_mcp.py", "stdio", "--session", request["session"], "--bot", request["bot"]],
        env={**os.environ, "DISPLAY": f":{display}"}, cwd="/workspace",
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            if request["method"] == "list":
                return {"tools": [t.model_dump(mode="json", exclude_none=True) for t in (await session.list_tools()).tools]}
            result = await session.call_tool(request["name"], request.get("arguments", {}))
            return result.model_dump(mode="json", exclude_none=True)


if __name__ == "__main__":
    try:
        request = json.loads(base64.b64decode(sys.argv[1]))
        result = asyncio.run(main(request))
    except Exception as error:
        result = {"isError": True, "content": [{"type": "text", "text": str(error)}]}
    print("BOPS_RESULT=" + json.dumps(result, separators=(",", ":")))
