"""The HELIO shock schema (mirrors web/lib/compass/world/types.ts `Shock`) and a strict validator.

The news agent reads real news; the parser turns an event into ONE of these shocks. Anything that
doesn't validate is rejected rather than "best-guessed" into the simulator.
"""


import json
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, TypeAdapter, ValidationError


class _Base(BaseModel):
    startYear: int = Field(..., ge=2026, le=2036)
    durationYears: int = Field(..., ge=1, le=10)


class Heatwave(_Base):
    type: Literal["heatwave"]
    severity: float = Field(..., gt=0, le=1)


class HeavyRain(_Base):
    type: Literal["heavy_rain"]
    severity: float = Field(..., gt=0, le=1)


class OilPriceSpike(_Base):
    type: Literal["oil_price_spike"]
    carCostIncreasePct: float = Field(..., gt=0, le=200)


class Pandemic(_Base):
    type: Literal["pandemic"]
    demandDropPct: float = Field(..., gt=0, le=95)
    recoveryYears: int = Field(..., ge=0, le=10)


class GridCarbonSpike(_Base):
    type: Literal["grid_carbon_spike"]
    gridFactorMultiplier: float = Field(..., gt=1, le=3)


class MrtLoopClosure(_Base):
    type: Literal["mrt_loop_closure"]
    mrtSpeedupPct: float = Field(..., gt=0, le=50)


class Haze(_Base):
    """Transboundary smoke haze. psi = typical 24-h PSI on haze days (NEA scale); daysPerYear = haze days."""

    type: Literal["haze"]
    psi: float = Field(..., ge=51, le=500)
    daysPerYear: int = Field(..., ge=1, le=180)


Shock = Union[Heatwave, HeavyRain, OilPriceSpike, Pandemic, GridCarbonSpike, MrtLoopClosure, Haze]
_ADAPTER = TypeAdapter(Shock)


class NewsEvent(BaseModel):
    """Structured output of the news agent: one event and, if relevant, its shock."""

    headline: str
    source_url: str
    date: str
    relevant: bool = Field(..., description="Does this event change travel, energy or heat in the district?")
    shock: Optional[Shock] = None
    rationale: str = Field(..., description="Why this shock and these magnitudes; cite the article.")


def validate_shock(shock_json: str) -> dict:
    try:
        obj = json.loads(shock_json) if isinstance(shock_json, str) else shock_json
        s = _ADAPTER.validate_python(obj)
        return {"valid": True, "shock": s.model_dump(), "errors": []}
    except (ValidationError, json.JSONDecodeError, TypeError) as e:
        errs = e.errors() if isinstance(e, ValidationError) else [str(e)]
        return {"valid": False, "shock": None, "errors": [str(x) for x in errs][:6]}
