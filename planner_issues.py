"""Responsibility: compose issue assignment changes in a validated plan. Persistence and validation belong to planner_store."""


def affects(issue, activity):
    if issue["scope"] == "ALL":
        return True
    if issue["scope"] == "STREAMS":
        return activity["streamId"] in issue["streamIds"]
    return activity["id"] in issue["activityIds"]


def assign_activity(plan, activity):
    desired = set(activity["issueIds"])
    for issue in plan["issues"]:
        assigned = issue["id"] in desired
        if affects(issue, activity) == assigned:
            continue
        targets = {item["id"] for item in plan["activities"] if affects(issue, item)}
        if assigned:
            targets.add(activity["id"])
        else:
            targets.discard(activity["id"])
        issue["scope"] = "ACTIVITIES"
        issue["streamIds"] = []
        issue["activityIds"] = [item["id"] for item in plan["activities"] if item["id"] in targets]
