"""Measurement-integrity labels (PRD section 11). Every displayed number carries one."""
from enum import Enum


class Label(str, Enum):
    MEASURED = "Measured"            # our own sensors
    SOURCED = "Sourced"              # named external dataset with timestamp (CoStar, ERCOT, WRI)
    ESTIMATED = "Estimated"          # derived by a documented method
    SIMULATED = "Simulated"          # scenario / replay / hypothetical
    UTILITY_CONFIRMED = "Utility-confirmed"  # from a utility study (expected empty in the hackathon)
    UNKNOWN = "Unknown"              # value not available; never filled with a guess
