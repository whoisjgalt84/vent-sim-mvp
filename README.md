# Ventilator Simulator (MVP v0.1)

[![Smoke Tests](https://github.com/whoisjgalt84/vent-sim-mvp/actions/workflows/smoke-test.yml/badge.svg)](https://github.com/whoisjgalt84/vent-sim-mvp/actions/workflows/smoke-test.yml)

A physics-driven mechanical ventilator simulator focused on clarity, correctness, and clinical teaching value.

---

## Current Capabilities

- Volume Control Continuous Mandatory Ventilation (VC-CMV)
- Pressure Control Continuous Mandatory Ventilation (PC-CMV)
- Single-compartment lung model (R + C)
- Patient effort (Pmus)
- Breath phase state machine
- Smoke-tested engine safety

---

## Project Philosophy

This simulator prioritizes:

- Physiologic correctness over visual flash
- Explicit cause → effect relationships
- Breath-sized incremental development
- Continuous verification (CI)

The goal is not just to simulate waveforms —  
but to make mechanical ventilation intuitive.

---

## Project Structure

- `js/ventilator.js` — ventilator logic  
- `js/lung-model.js` — lung mechanics  
- `js/simulation.js` — engine loop  
- `js/waveforms.js` — rendering  
- `js/test-engine.js` — smoke tests  
- `.github/workflows/` — CI automation  

---

## Running Tests Locally

From the project root:

---

## Clinical References

The physics model, breath-state machine, and patient–ventilator interaction
categories used in this simulator are grounded in the following sources:

1. **Mireles-Cabodevila E, Vaporidi K, Blanch L, Chatburn RL.**
   *Defining and Measuring Patient–Ventilator Interactions: 10 Fundamental Maxims.*
   Respiratory Care, 2026. DOI: [10.1177/19433654261425219](https://doi.org/10.1177/19433654261425219)
   Provides the framework for the equation of motion as the foundation of
   patient–ventilator interaction, the three states of inspiration
   (unassisted / active assisted / passive assisted), and the definitions of
   synchrony, asynchrony, and work-shifting used throughout the engine.

2. **Chatburn RL.**
   *How to Interpret Ventilator Waveforms Using the Taxonomy for Modes of Mechanical Ventilation.*
   Respiratory Care, 2026. DOI: [10.1177/19433654251395626](https://doi.org/10.1177/19433654251395626)
   Basis for the mode taxonomy (VC-CMV, PC-CMV), the time-constant
   derivations, and the waveform-interpretation procedure reflected in the
   rendering layer.
