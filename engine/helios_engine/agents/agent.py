"""HELIOS agent team (Google ADK). Run with `adk web` / `adk run` from engine/, or via run_agent.py.

    root: helios ─┬─ planner      (portfolio under budget, regret across pathways, charger sizing)
                  ├─ red_team     (argues against the plan: value of information, validation limits)
                  ├─ librarian    (finds any of 7,489 public datasets and cites them)
                  ├─ news_scout   (AgentTool, Google Search grounding: live SG transport/energy news)
                  └─ shock_parser (AgentTool, structured output: news event → validated simulator shock)

Rules enforced in code, not just prompts:
  • every number in a final answer must trace to a tool result (guardrails.check_answer);
  • overclaiming language is flagged; the logit output is a modelled reallocation, never a forecast.
Requires GEMINI_API_KEY (Google AI Studio) or Vertex AI credentials to run.
"""
from __future__ import annotations

import json
import os

from google.adk.agents import LlmAgent
from google.adk.tools import AgentTool, google_search
from google.genai import types

from . import tools as T
from .guardrails import check_answer
from .shock_schema import NewsEvent

MODEL = os.environ.get("HELIOS_MODEL", "gemini-2.5-flash")

HONESTY = (
    "Never state a number you did not get from a tool in this conversation. Quote tool numbers as given "
    "(round sensibly) and name the source. Mode shifts are a calibrated, modelled reallocation — never call "
    "them a forecast or a guarantee. If a tool cannot answer, say so."
)


def _remember_tool_result(tool, args, tool_context, tool_response):
    log = list(tool_context.state.get("helios_tool_results", []))
    log.append({"tool": getattr(tool, "name", str(tool)), "result": tool_response})
    tool_context.state["helios_tool_results"] = log[-30:]
    return None


def _citation_guard(callback_context, llm_response):
    """Flag unsupported numbers / overclaims in a final (non-tool-call) answer."""
    content = getattr(llm_response, "content", None)
    if not content or not content.parts:
        return None
    if any(getattr(p, "function_call", None) for p in content.parts):
        return None
    text = "".join(p.text or "" for p in content.parts if getattr(p, "text", None))
    if not text:
        return None
    results = [r["result"] for r in callback_context.state.get("helios_tool_results", [])]
    verdict = check_answer(text, results)
    callback_context.state["helios_last_guard"] = verdict
    if verdict["ok"]:
        return None
    note = "\n\n⚠ Guardrail: "
    if verdict["unsupported_numbers"]:
        note += f"could not trace {', '.join(verdict['unsupported_numbers'][:5])} to a tool result — treat as unverified. "
    if verdict["overclaims"]:
        note += f"overclaiming language removed/flagged ({', '.join(verdict['overclaims'])})."
    content.parts.append(types.Part(text=note))
    return llm_response


common = dict(model=MODEL, after_tool_callback=_remember_tool_result, after_model_callback=_citation_guard)

planner = LlmAgent(
    name="planner",
    description="Builds the investment plan: best interventions within a budget, risk attitude, robustness across Green Plan pathways, EV charger sizing.",
    instruction=(
        "You are a transport and energy planner for a Singapore district. Use list_interventions to see options, "
        "recommend_portfolio for a budget (ask for the budget if not given; default risk_aversion 0.5), "
        "pathway_regret to check robustness, size_ev_chargers for charging hubs. Explain the trade-off in plain "
        "language: what to fund, what it costs, expected net benefit, worst-case. " + HONESTY
    ),
    tools=[T.list_interventions, T.recommend_portfolio, T.pathway_regret, T.size_ev_chargers],
    **common,
)

red_team = LlmAgent(
    name="red_team",
    description="Challenges a plan: what could make it wrong, what uncertainty matters, which study to fund first.",
    instruction=(
        "You are the sceptical reviewer. For the plan under discussion, call value_of_information and "
        "model_validation. State the single uncertainty that most affects the decision, what study resolves it, "
        "what it costs and what it is worth. Name validation limits honestly (e.g. commute-based calibration, "
        "proxy study costs). Do not soften bad news. " + HONESTY
    ),
    tools=[T.value_of_information, T.model_validation, T.list_interventions, T.pathway_regret],
    **common,
)

librarian = LlmAgent(
    name="librarian",
    description="Finds Singapore government datasets relevant to a question and cites them by id and URL.",
    instruction="Use find_datasets to locate relevant public datasets. Return titles, agencies, coverage and URLs. " + HONESTY,
    tools=[T.find_datasets],
    **common,
)

news_scout = LlmAgent(
    name="news_scout",
    model=MODEL,
    description="Searches the web for recent Singapore transport, energy, heat and fuel-price news.",
    instruction=(
        "Search for news from the last 30 days that could change travel behaviour, energy prices, grid carbon or "
        "heat in Singapore (e.g. MRT line openings/closures, fuel price changes, heatwaves, ERP changes). Return up "
        "to 5 items: headline, date, URL, one-line summary. Only report what the sources say."
    ),
    tools=[google_search],  # Search grounding must be the agent's only tool
)

shock_parser = LlmAgent(
    name="shock_parser",
    model=MODEL,
    description="Converts ONE news item into a structured, validated HELIO simulator shock (or marks it irrelevant).",
    instruction=(
        "Given one news item, decide if it changes travel, energy or heat. If yes, choose exactly one shock type "
        "(heatwave, heavy_rain, oil_price_spike, pandemic, grid_carbon_spike, mrt_loop_closure, haze — haze needs psi and daysPerYear) and magnitudes "
        "justified by the article, years 2026–2036. If unsure, set relevant=false. Explain in rationale."
    ),
    output_schema=NewsEvent,
)

root_agent = LlmAgent(
    name="helios",
    description="HELIOS city decarbonisation copilot for planners.",
    instruction=(
        "You coordinate the HELIOS team for a city planner. Route: planning/budget questions → planner; "
        "'what could go wrong' / uncertainty → red_team; 'what data exists' → librarian; 'what happened in the "
        "news' → call news_scout, then shock_parser for each relevant item, then check_shock to validate before "
        "proposing it as a scenario. For accuracy questions call model_validation; for heat at a time call "
        "heat_at_hour. Finish every plan by asking red_team to challenge it. " + HONESTY
    ),
    sub_agents=[planner, red_team, librarian],
    tools=[AgentTool(agent=news_scout), AgentTool(agent=shock_parser), T.check_shock, T.model_validation, T.heat_at_hour],
    **common,
)
