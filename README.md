<div align="center">

# HELIOS

### From a rooftop to a city: evidence-led sustainability planning, powered by Google.

**Explore a place. Design a change. Test its impact. Build a decision.**

Singapore · Bangkok · Hanoi · Bengaluru · Delhi NCR · Mumbai · Hyderabad · Chennai · Kolkata · Pune · Ahmedabad

[Explore the capabilities](#what-you-can-do) · [Built with Google](#built-with-google) · [Inside the engine](#inside-the-engine) · [Run locally](#run-locally)

</div>

---

HELIOS brings urban mobility, rooftop solar, heat exposure, EV charging, building carbon, policy screening and investment analysis into one interactive planning environment. It helps planners, building owners and project teams move from **“What could we change here?”** to a concrete, costed scenario with explicit assumptions, environmental trade-offs and a practical decision brief.

Start with a whole-island view of Singapore, investigate a district, draw a shaded cycling corridor, add solar and charging, and compare the package against an evolving baseline through 2036. Inspect its carbon, heat, mobility and financial results; check physical placement and encoded policy rules; then explore funding, suppliers, rollout and monitoring. Elsewhere, assess a rooftop in Bangkok, compare managed charging in Hanoi, or test cool roofs and rain gardens across eight Indian cities.

The project's strength is the connection between these layers: **a map-based intervention can flow through behavioural modelling, lifecycle accounting, financial analysis, compliance screening and an AI-assisted review in the same workflow.**

> HELIOS is a planning and decision-support prototype. Its calculations support transparent scenario exploration and early feasibility screening. Modelled outcomes, source data, assumptions and illustrative visuals have different meanings, and the application exposes those distinctions.

## Built with Google

Google technologies connect the physical place, the evidence and the explanation. Their roles are implemented across the application and Python agent layer.

| Technology | Role in HELIOS |
| --- | --- |
| **Google Maps JavaScript API, Maps 3D and Places** | Interactive geographic exploration, location search, rooftop selection and spatial context for planning. |
| **Google Maps satellite imagery and Street View** | Site context for roof estimation, visual feasibility assessment and before/after report imagery. |
| **Google Solar API** | Building insights where covered: roof geometry, usable solar area, roof segments, panel configurations and estimated annual generation. |
| **Gemini** | Natural-language intervention interpretation, satellite-image roof estimates, site analysis, streamed solar proposals, planning memos and explanations grounded in supplied model results. |
| **Gemini image generation** | Illustrative rooftop solar installation images shown alongside the original imagery. |
| **Google Agent Development Kit (ADK)** | A six-stage Agent Studio and a routed planning assistant that call HELIOS simulation, compliance, screening and evidence tools. |
| **Google Search grounding** | A news scout retrieves relevant current transport and energy context; structured parsing translates supported events into scenario shocks. |
| **Gemma-compatible model paths** | Configuration for local or hosted language features, including resident reactions and policy-rule drafting. The configured endpoint and model determine availability. |
| **Google Cloud** | Container build and deployment tooling for Cloud Build and Cloud Run, Cloud Storage for persisted reports and rule artifacts, Secret Manager for runtime credentials, and an IAP-protected preview deployment path. |

Solar API outputs feed the project's solar and financial calculations. Gemini can interpret an idea or explain results, while deterministic code calculates the numerical outcomes. The agent team chooses and sequences tools, then reviews and communicates their results.

Live integrations require appropriate API access, enabled services, coverage and quota. Cached demonstration assets are available for selected workflows; optional imagery or model failures can produce partial reports.

## What you can do

### 1. Explore Singapore and diagnose a district

Begin with a whole-island planning view, then select a planning area. Rank populated areas by car commuters, senior residents, transit gap or population, and distinguish simulation-ready areas from areas with map and contextual coverage.

Inspect demographics, commuting shares, housing characteristics, transit infrastructure, modelled transport emissions, mode split and solar-ready assets. Corridor diagnosis highlights demand, heat exposure and shade deficits; map-linked hovering connects a finding to the place where an intervention could help.

### 2. See the city in motion

Explore mapped 3D buildings and animated car, bus, MRT, walking and cycling movement along route geometry. Switch transit-flow, corridor heat, recommended EV-site, nature and flood-related overlays on and off. Select buildings, control the living-agent display, move between years and play the scenario timeline.

Country and city navigation, guided demonstrations, legends and explanatory controls help connect the map to the analysis. Animated travellers illustrate modelled movement; they are not tracked people or live vehicle positions.

### 3. Draw and compose interventions

Draw a **point**, **corridor** or **zone**, name the change, select its implementation year and assign a cost tier. Combine capabilities within one intervention, edit a package manually, or apply a recommended package to the map.

Supported capabilities include cycling links, walking links, shade, rain protection, car restrictions, cycling shortcuts, better bus service, solar generation, EV charging and battery storage. Quantity-based costs are used where supported. Circular-procurement options include second-life batteries, recyclable-PV assumptions and modular construction.

### 4. Describe an idea in ordinary language

Enter an idea such as a shaded cycling connection with solar charging. HELIOS maps the description to its supported capability vocabulary, proposes a cost tier and recognises circularity terms. The interface exposes the interpretation, rationale, confidence and rule-based or AI source label.

A deterministic keyword path accompanies AI classification, and AI-selected capability identifiers are validated. Novel descriptions are interpreted through existing model primitives rather than automatically becoming new engineering models.

### 5. Model mobility and behavioural response

A five-mode nested-logit model represents car, bus, MRT, walking and cycling choices. Public transport and active travel have separate nests. Travel time, monetary cost, bus waiting time, heat, rain, comfort, safety and distance feasibility influence the response.

Planning-area calibration constants are informed by census mode shares. Interventions modify corridor attributes, producing modelled mode-share changes, trips shifted away from cars and transport emissions. Logsum changes support traveller-welfare calculations, with area-level benefit-incidence indicators for seniors and lower-income households.

These results are an illustrative calibrated reallocation, not a validated ridership forecast.

### 6. Test changing futures from 2026 to 2036

Compare interventions against a policy-evolved baseline with changing grid factors, vehicle emission factors, transport assumptions and gradual adoption. Explore target-achieved, delayed, accelerated and frozen pathways, plus an LTA EV-trend option.

Stress-test plans with heatwaves, heavy rain, oil-price shocks, pandemic-related demand changes, grid-carbon spikes, MRT disruption and haze. Matched shocks are applied to both the baseline and intervention scenario before additional impact is calculated.

### 7. Compare carbon, heat and scenario outcomes

Track annual and cumulative avoided emissions, transport emissions, net avoided carbon after embodied-carbon accounting, solar generation, charging energy, modelled EV-related savings, mode shares, car-trip shifts and spending.

Inspect baseline-versus-intervention timelines and person-distance-weighted active-travel heat exposure. Save scenarios as A and B to compare carbon, capex, cost per tonne, heat, NPV, budget share and intervention count. Heat exposure is a modelled index, not a measured temperature reduction.

### 8. Evaluate financial and investment value

Review quantity-based capex, operating and maintenance costs, implementation-year cash flows, discounted operator cash NPV and social NPV. Compare cash and social payback, carbon payback, cost per tonne, budget share, carbon-price benefits and benefit–cost ratios incorporating modelled traveller benefits.

The application supports USD, SGD, THB and VND display/conversion; India solar workflows include INR financial scenarios.

### 9. Find packages and explore trade-offs

Generate shade, cycling, bus, solar and EV candidates from district conditions. Candidates are simulated individually, screened for placement and regrettable substitution, and scored against cost. The main interface selects a budget-constrained package using a greedy method with intervention-family diversity limits.

The selected package is simulated jointly to assess interactions. Pareto views and alternative objective weights expose trade-offs between carbon, heat relief and cost. A separate Python optimiser adds risk-aware mathematical portfolio selection.

### 10. Check physical placement

Screen drawn paths against building footprints and height-tagged obstructions where available. Flag rail overlaps and station conflicts, review EV placement, and check whether a solar canopy has an obvious nearby host structure. Proximity checks provide a fallback where geometry is incomplete.

Checks return **block**, **review** or **OK**, with explanations and corrective actions. They support desk screening; land ownership, structural approval and right-of-way clearance require further work.

### 11. Inspect deterministic compliance rules

Structured rule data is separate from the evaluator. Checks account for as-of dates, effective and expiry dates, applicability, missing inputs and numerical threshold margins. Outcomes distinguish pass, fail, informational, not applicable and needs information.

Source-document, clause and page references accompany rule-confidence and input-provenance labels. Building and intervention badges expose results, while proposed policy remains distinct from encoded in-force rules. Next-step explanations can show the improvement required to reach another tier.

### 12. Use specific policy and building calculators

The encoded calculators cover:

- **Green Mark:** EUI by building type and cooling category; Gold, GoldPLUS, Platinum and SLE thresholds; energy/floor-area derivation; configured solar and charging adjustments; next-tier energy gaps and indicative solar capacity.
- **Energy status:** Super Low Energy, Zero Energy and Positive Energy screening, plus building-certificate status and expiry.
- **Singapore-Asia Taxonomy:** classifications for supported buildings and activities.
- **Vehicles:** worst-pollutant VES bands, period/class-specific rebates and surcharges, capped EEAI rebates and configured ARF-floor treatment, with editable EV, hybrid, petrol-car and taxi presets.
- **Carbon tax:** direct-emissions reporting/taxability screening and bill calculations.
- **EV Charging Act:** development triggers and exemptions; the implementation flags missing detail for the separate minimum-provision order.
- **Climate reporting:** obligation lookup by entity category and financial year.

These are the rules encoded in this repository, not a fresh legal audit or certification.

### 13. Explore carbon-price “what if?” scenarios

Compare encoded law with low, central and high future-price pathways. Inspect proposed-versus-law status, facility tax bills, building electricity carbon-cost exposure and rankings by additional exposure. Revalue an intervention's avoided carbon and see how its net cost per tonne changes.

### 14. Draft and review policy rules

Read prepared policy-document pages and generate structured drafts for rates, thresholds, requirements, exemptions, dates and definitions. Attach source text and page references, track quotation verification, and compare draft values against existing rules.

Approve, reject or leave drafts pending, then promote approved drafts into candidate files with suggested evaluator mappings. Promotion does not activate a production rule: developer mapping, worked examples, validation and registration remain necessary. Source-page extracts must be supplied separately where absent.

### 15. Build building-carbon and portfolio disclosures

Estimate electricity from historical EUI and floor area, apply year-specific grid factors, and disclose carried-forward factors. Calculate location-based Scope 2 emissions and intensity, inspect historical and consistent-portfolio trends, and enter owner-supplied Scope 1 emissions while keeping missing values distinct from zero.

Select portfolio buildings, inspect exclusions and data gaps, screen reporting obligations and direct-emissions tax treatment, and summarise taxonomy classifications by floor area. Generate a draft disclosure, reporting-gap checklist and CSV working file. Same-type BCA sample benchmarks provide context; historical energy estimates do not replace current bills or certification.

### 16. Screen nature, biodiversity and physical risk

Inspect protected and sensitive habitats, water bodies, flood-prone locations, ground elevation, vegetation, tree cover, heritage trees and GBIF species occurrences, including globally threatened-species labels.

Building and area summaries separate nature, flood and heat groups, with low, elevated, high or unknown outcomes. Sources, caveats and the distinction between cited and methodological thresholds remain inspectable. These are early screens, not flood-depth predictions or complete ecological assessments.

### 17. Account for lifecycle carbon and circularity

Estimate construction embodied carbon by quantity, inspect material passports and material masses, and calculate mass-weighted recyclable shares. Include replacements within the assessment horizon, end-of-life assumptions, supplier take-back, second-life batteries, recycled-PV and modularity options.

Carbon-debt, carbon-payback and regrettable-substitution checks expose cases where construction or replacement impacts undermine operating savings. The analysis can distinguish an intervention justified by heat or mobility benefits from one justified primarily by carbon savings.

### 18. Turn analysis into a funding and delivery decision

Produce **fund**, **conditional fund**, **study** or **defer** outcomes with reasons and conditions. Build rollout phases, match infrastructure to grants and city-specific suppliers, inspect indicative offsets and net capex, and filter vendors by take-back, second-life and recycled-content credentials.

Funding and vendor directories cover Singapore, Bangkok and Hanoi, with eligibility, confidence, verification and limitation labels. Decision briefs also include land/grid/permit prompts, heuristic grid-load bands, illustrative van or taxi fleet reconciliation, SDG/GRI-topic alignment and monitoring recommendations such as metered solar yield, charger utilisation and pedestrian counts.

Directory entries do not guarantee funding or supplier suitability, and grid screening is not a feeder power-flow study.

### 19. Challenge results with backtests and failure cases

A live-engine backtest panel compares representative treated corridors against stored Ang Mo Kio cycling, TransJakarta bus and Orchard Road pedestrian cases. It reports direction matches and conservative, in-range, overshoot or wrong-direction classifications against published ranges.

Calibration panels, temporal census and five-fold spatial evaluation artifacts, baseline diagnostics, simulator self-checks and verification scripts make model behaviour inspectable. A deliberate failure gallery tests standalone batteries, paths through towers, solar without a host and poor carbon value, showing both caught cases and misses.

These comparisons test directional plausibility and magnitude. A smaller modelled effect does not establish a reliable lower bound on real-world outcomes.

### 20. Quantify uncertainty and the value of better evidence

Monte Carlo reruns vary behavioural response, capex and EV displacement, producing percentile summaries and conditional positive-carbon probabilities. Sensitivity tools include one-at-a-time tornado charts and policy-pathway comparisons.

The Python analytical layer adds Latin hypercube sampling, Gaussian-copula parameter dependence, Gaussian-process surrogates with cross-validation, Sobol indices, expected value of perfect information (EVPI), parameter-specific value of information (EVPPI) and comparisons with assumed study costs.

Mean–CVaR mixed-integer optimisation balances expected benefits against downside risk under budget and intervention-family constraints. Joint simulations check additive portfolio estimates; minimax-regret analysis compares policy pathways, and stored draws support re-optimisation. These advanced tools are not all executed by each ordinary map interaction.

### 21. Examine heat, solar physics and charging operations

The engine includes sun-position calculations, building-based ray-cast shade, sun/shade mean radiant temperature, UTCI thermal stress, weather-derived hourly climatology and temperature-corrected PV generation. Bass diffusion fitting and holdout artifacts support adoption-trajectory analysis.

Hourly dispatch optimisation models solar, batteries and flexible EV charging with state-of-charge, efficiency, demand and plug-in constraints. Compare cost-only, carbon-focused and carbon-priced dispatch, including break-even carbon prices. Erlang-C charger sizing estimates utilisation, expected waits and wait-target exceedance, selecting the smallest charger count meeting a service target.

### 22. Work with a six-stage AI team

Google ADK orchestrates an inspectable sequence:

**Designer → Analyst → Compliance officer → Site analyst → Red team → Narrator**

The designer chooses supported costed candidates; the analyst runs the numerical scenario; compliance and site agents call screening tools; a red team challenges the plan; and the narrator explains the results. Progress streams to the interface, and follow-up edits can modify the active plan or validated shocks.

A separate routed chat team supports planning, challenge, data retrieval, Search-grounded news and shock interpretation. Tool-result history, numerical traceability checks and overclaim-language flags support answer review. Model health, output controls and caching help manage execution. Session state is not durable across instance restarts, and numerical matching alone cannot prove factual correctness.

### 23. Trace the data and hear contextual perspectives

Search government dataset catalogues through TF-IDF lexical retrieval, optional embedding reranking, recency weighting and recurring-table edition deduplication. Results include publishers, dataset IDs, coverage and URLs.

Ingestion scripts and a source registry capture retrieval dates, freshness and file fingerprints; frozen runtime datasets make demonstrations inspectable. The Open Stack view connects capabilities with sources and licence information.

Civic-discourse scores expose sample sizes and quotations. Census-informed synthetic profiles support generated resident reactions, with recorded-response labels where demo outputs are replayed. These selective discourse proxies and generated reactions do not constitute public consultation or observed behaviour.

### 24. Assess rooftop solar with Solar Scout

Search a location or select a roof. Where covered, Google Solar building insights supply roof area, usable area, panels, capacity, generation, segment orientation/pitch and imagery-quality/date labels. AI-assisted estimation and manual roof drawing provide additional assessment paths with their own provenance.

Country-specific tariffs, installation costs and grid factors feed payback, annual and lifetime savings, NPV and LCOE. Calculations include degradation, O&M and self-consumption assumptions, with a transport-footfall-based load-profile module available.

Satellite and Street View context support AI siting commentary on placement, obstructions and pedestrian clearance. Stream proposals and memos, inspect illustrative before/after sliders, and use aerial flyovers where available. Generated images are concepts, not engineering layouts or proof of buildability.

### 25. Plan Hanoi charging around grid carbon

Map existing chargers and candidate sites with categories, coverage gaps, nearest provision and rationale. Add or remove L2 AC, DC fast-charging and solar-canopy sites under a budget, or request a recommended portfolio.

Compare category-specific managed charging against an evening-heavy baseline. Inspect charging-weighted grid intensity, solar-window alignment, annual modelled savings, peak-shaving estimates, capex, remaining budget and annual/lifetime-levelised cost-per-tonne measures. Portfolio profiles and AI site analysis connect energy results to location context. Hourly grid intensity and utilisation include proxies rather than measured Hanoi dispatch or charger telemetry.

### 26. Test urban interventions across eight Indian cities

Draw a study boundary, search a location or select an explicitly synthetic one-hectare test area. Adjust roof, paving and existing-green shares, then combine cool roofs, trees, shade structures, permeable paving, rain gardens and rainwater harvesting.

Ground-allocation constraints prevent intervention areas from exceeding available paving. Tree-canopy maturation, editable storm depths and runoff coefficients, tank capacity and rain-garden storage determine before/after area and water balances. Inspect shade, cool-roof area and solar absorption; calculate cooling electricity and carbon when the required baseline is supplied.

Compare A/B scenarios, export inputs/results and request an AI explanation of the actual calculation. Roof-level Solar API, vision and manual paths support panel geometry where available, INR scenarios, self-consumption/export assumptions, solar proposals and generated visuals. Geometry and range validation constrain inputs. This is an area, water and energy balance under stated assumptions, not a prediction of citywide temperature or flood depth.

### 27. Export a decision people can review

Combine numerical findings, imagery and caveats in intervention feasibility reports. Use cached site-specific or drawn-intervention reports, print/PDF layouts and browser-generated PowerPoint decision briefs.

Exports can include rollout, funding, suppliers, procurement, risks, monitoring, financials, lifecycle and confidence details. Carbon CSV files, copyable disclosure drafts and India scenario exports support follow-on work, with sources and assumptions carried into reporting surfaces.

## Inside the engine

| Layer | Implementation |
| --- | --- |
| Interface and mapping | Next.js 14, React, TypeScript, Tailwind CSS, Google Maps and deck.gl. |
| Application calculations | TypeScript modules for scenario timelines, mobility response, finance, lifecycle carbon, compliance, nature and geometry. |
| Scientific analysis | Python/FastAPI with NumPy, pandas, SciPy, scikit-learn, SALib, pvlib, pythermalcomfort and Shapely. |
| AI orchestration | Google ADK agents, Gemini calls and configurable compatible language-model endpoints. |
| Evidence | Bundled runtime datasets, source registries, ingestion tools, calibration outputs and catalogue retrieval. |
| Delivery | Docker, Google Cloud build/deployment templates, report storage and smoke checks. |

The browser and Next.js API layer handle the interactive planning experience. The Python service provides scientific and agent capabilities. Agent tools call the application's numerical and screening endpoints, keeping calculations inspectable in code and explanations connected to tool results.

### Repository map

```text
web/
  app/                      Pages and API routes
  components/               Maps, workspaces, panels and reports
  lib/compass/              Singapore planning, rules, finance and lifecycle
  lib/hanoi/               Charging profiles and grid-carbon calculations
  lib/india/               Urban balances, solar and geometry
  lib/cloud/               Report and rule-artifact storage
  data/                    Runtime evidence, assumptions and policy rules
  scripts/                 Verification and report-generation tools
engine/
  api/                     FastAPI service
  helios_engine/agents/    ADK Studio, routed agents and data librarian
  helios_engine/choice/    Mobility calibration and mode choice
  helios_engine/heat/      Shade and thermal-stress modelling
  helios_engine/energy/    PV, dispatch and charger queues
  helios_engine/uncertainty/ Sampling and sensitivity
  helios_engine/decision/  Portfolio optimisation and information value
  data/                    Catalogues, processed inputs and model artifacts
  tests/                   Python regression tests
scripts/deploy/            Cloud preparation, deployment and smoke checks
deploy/                    Configuration and runtime templates
tests/deploy/              Deployment-tooling tests
```

This repository contains the active application and supporting code/data. Historical app versions, research documents, chat logs, credentials, dependencies and build outputs are excluded.

## Run locally

### Prerequisites

- Node.js **22 or newer** and Python **3.11**.
- Your own Google Maps, Solar and Gemini API credentials for the live features you use.
- Appropriate API enablement, billing/quota and browser-key restrictions for your Google project.

### 1. Install and configure

```bash
git clone https://github.com/PrathamRanjan/helios-final.git
cd helios-final
npm run install:web
cp web/.env.example web/.env.local
python3 -m venv .venv
source .venv/bin/activate
pip install -r engine/requirements.txt
```

Fill in `web/.env.local` using the supplied template:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Browser Maps key; restrict it by allowed referrers and APIs. |
| `GOOGLE_MAPS_API_KEY` | Server-side map and imagery requests. |
| `GOOGLE_SOLAR_API_KEY` | Solar building insights. |
| `GEMINI_API_KEY` | Gemini vision, generation and language routes. |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | Hosted language features; the template uses Google's compatible endpoint. |
| `ENGINE_URL` | Python service URL, locally `http://127.0.0.1:8081`. |
| `HELIOS_INTERNAL_APP_URL` | Internal application URL, locally `http://127.0.0.1:3000`. |
| `HELIOS_STORAGE_BUCKET` | Optional Cloud Storage bucket; leave unset for local filesystem storage. |

Keep populated environment files out of Git. For optional local-model use, configure a compatible model server and a separate port if the Python engine already occupies `8081`.

### 2. Start the Python service

In a terminal with the virtual environment active, export your own `GEMINI_API_KEY`, then run:

```bash
cd engine
HELIOS_APP_URL=http://127.0.0.1:3000 uvicorn api.main:app --port 8081
```

The Python process needs its own environment credentials; Next.js's `.env.local` does not configure that shell automatically.

### 3. Start the web application

From the repository root in a second terminal:

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000). Start with `/sg` for Singapore, `/helio-flow` for Solar Scout, `/bangkok`, `/hanoi`, or `/india` for the regional workspaces. `/sg/rules` opens the rules desk, and `/sg/open` exposes the Open Stack view.

### Verification commands

```bash
# Root verification: India, urban and cloud-storage checks
npm run verify

# Additional Singapore simulation and policy checks
npm --prefix web run verify
npm --prefix web run verify:compliance
npm --prefix web run verify:carbon
npm --prefix web run redteam

# Python and deployment-tooling tests
python3 -m unittest discover -s engine/tests -v
python3 -m unittest discover -s tests/deploy -v
```

Some checks and optional workflows require their relevant data, credentials or running services. These commands describe the available checks; they do not imply that every live integration has been validated in every environment.

### Google Cloud deployment

Start from `deploy/config.example.json`, `deploy/runtime.env.example` and `deploy/service.template.yaml`. `scripts/deploy/cloud.py` supports configuration checks, template rendering, infrastructure setup, builds, deployment, artifact seeding and policy-page uploads. Cloud-changing operations default to a dry run and require `--execute` to perform them. The supplied deployment path uses an IAP-protected private preview.

## Evidence and interpretation

HELIOS is most useful when its assumptions are part of the decision. Inspect source dates, coverage, model parameters, uncertainty and missing inputs alongside each result. Source-backed measurements, calibrated estimates, user inputs, assumptions, cached responses and generated visuals should remain identifiable.

A compelling proposal should survive scrutiny: a budget check, a building obstruction, a policy gap, an embodied-carbon penalty or an unfavourable future can all change the recommendation. HELIOS brings those questions into the planning process, connecting an ambitious idea with the evidence needed to decide what to investigate, fund and measure next.
