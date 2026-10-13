import argparse
import asyncio
import json

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client


async def smoke(url, allow_mutations):
    if not url.endswith("/mcp"):
        raise ValueError("Use the exact /mcp URL without a trailing slash")
    base = url[:-4]
    async with httpx2.AsyncClient(timeout=15) as http:
        before = (await http.get(base + "/api/state")).json()
        async with Client(streamable_http_client(url, http_client=http)) as client:
            tools = await client.list_tools()
            listed = await client.call_tool("list_plans")
            if listed.is_error or listed.structured_content["revision"] != before["revision"]:
                raise AssertionError("MCP and HTTP workspace reads disagree")
        if not allow_mutations:
            return {"tools": [tool.name for tool in tools.tools], "revision": before["revision"], "plans": len(before["plans"]), "mode": "read-only"}
        if before["plans"]:
            raise ValueError("Mutation smoke tests require an isolated empty workspace")
        login = await http.post(base + "/api/session/login", json={"username": "local-admin"})
        login.raise_for_status()
        http.headers["Authorization"] = "Bearer " + login.json()["accessToken"]
        async with Client(streamable_http_client(url, http_client=http)) as client:
            identity = await client.call_tool("get_access")
            if identity.is_error or not identity.structured_content["canEdit"]:
                raise AssertionError("PocketHive local-admin verification failed")
            created = await client.call_tool("create_plan", {"plan_id": "smoke", "name": "MCP smoke test", "description": "Synthetic QA data, not an operational plan.", "expected_revision": before["revision"]})
            if created.is_error:
                raise AssertionError(created.content)
            revision = created.structured_content["revision"]
            fixture = (await http.get(base + "/example-plan.json")).json()["plans"][0]
            for collection in ("streams", "activityTypes", "issues", "activities"):
                for item in fixture[collection]:
                    result = await client.call_tool("create_plan_item", {"plan_id": "smoke", "collection": collection, "item": item, "expected_revision": revision})
                    if result.is_error:
                        raise AssertionError(result.content)
                    revision = result.structured_content["revision"]
            result = await client.call_tool("update_plan_item", {"plan_id": "smoke", "collection": "activities", "item_id": "example", "changes": {"progress": 55, "start": "2026-10-13", "status": "Updated through a real MCP client"}, "expected_revision": revision})
            if result.is_error:
                raise AssertionError(result.content)
            revision = result.structured_content["revision"]
            closed = await client.call_tool("update_plan_item", {"plan_id": "smoke", "collection": "issues", "item_id": "example-issue", "changes": {"open": False}, "expected_revision": revision})
            if closed.is_error or not closed.structured_content["plan"]["issues"][0].get("resolvedAt"):
                raise AssertionError("Issue closure did not record its resolution time")
            current = (await http.get(base + "/api/state")).json()
            stale = await client.call_tool("update_plan_item", {"plan_id": "smoke", "collection": "activities", "item_id": "example", "changes": {"progress": 66}, "expected_revision": revision})
            if not stale.is_error or "REVISION_CONFLICT" not in stale.content[0].text:
                raise AssertionError("Stale MCP update was not rejected")
            invalid = await client.call_tool("update_plan_item", {"plan_id": "smoke", "collection": "activities", "item_id": "example", "changes": {"progress": 101}, "expected_revision": current["revision"]})
            if not invalid.is_error or "INVALID_INPUT" not in invalid.content[0].text:
                raise AssertionError("Invalid MCP update was not rejected")
            if (await http.get(base + "/api/state")).json() != current:
                raise AssertionError("Rejected MCP edits changed saved data")
            loaded = await client.call_tool("get_plan", {"plan_id": "smoke"})
            if loaded.is_error or loaded.structured_content["plan"] != current["plans"][0]:
                raise AssertionError("MCP and HTTP saved plans disagree")
        del http.headers["Authorization"]
        async with Client(streamable_http_client(url, http_client=http)) as client:
            denied = await client.call_tool("update_plan", {"plan_id": "smoke", "changes": {"name": "Denied anonymous edit"}, "expected_revision": current["revision"]})
            if not denied.is_error or "AUTH_401" not in denied.content[0].text:
                raise AssertionError("Anonymous edit inherited an earlier identity")
        return {"tools": [tool.name for tool in tools.tools], "revision": current["revision"], "progress": current["plans"][0]["activities"][0]["progress"], "resolvedAt": current["plans"][0]["issues"][0]["resolvedAt"], "mode": "isolated mutation test"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Real MCP client smoke test; writes require an explicitly authorized empty QA workspace.")
    parser.add_argument("url")
    parser.add_argument("--allow-mutations", action="store_true")
    arguments = parser.parse_args()
    print(json.dumps(asyncio.run(smoke(arguments.url, arguments.allow_mutations))))
