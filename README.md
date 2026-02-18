# Ventilator Simulator (MVP v0.1)

[![Smoke Tests](https://github.com/whoisjgalt84/vent-sim-mvp/actions/workflows/smoke-tests.yml/badge.svg)](https://github.com/whoisjgalt84/vent-sim-mvp/actions/workflows/smoke-tests.yml)

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
