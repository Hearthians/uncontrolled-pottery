# Wet clay simulation references

Research checked on 2026-11-02 following close-up feedback on the v3 prototype. This is a design note, not a claim that the current simulation is physically validated.

## What the close-up revealed

The current implementation represents deposits as an elliptical tube around a particle chain. Collision samples, cross-section flattening and plastic rest curvature can change that chain, but they do not create a continuous material interface between neighboring layers. Large section changes can therefore look like ribbons or plates; separately capped strand interruptions can look like artificial wedges. A simulated contact is not yet a reconstructed bonded surface. Passing deterministic replay, finite-coordinate and UI tests does not establish clay realism.

Do not address this by adding visual noise, globally smoothing away layer lines, increasing gravity, or reducing stiffness until every object collapses. Keep the current solver explicitly experimental while developing reference cases.

## Primary sources and their limits

### 1. Actual clay-printing practice

**Jonathan Keep, A Guide to Clay 3D Printing (2020).**

- [Author page](https://keep-art.co.uk/guide-to-clay-3d-printing)
- [PDF linked by author](https://img1.wsimg.com/blobby/go/7e9a9a3a-abb7-4e12-a8ce-e6dc98a55f2a/JKeep-Guide%20to%20Clay%203D%20Printing%20-%202020.pdf)
- Read extracted PDF text, especially printed pp. 7–8 and 54.

Keep describes layers compressed together rather than merely touching circular extrusions. Too little compression can cause delayering during drying. Wall width can exceed nozzle diameter. The practical tests describe workable layer-height/nozzle-diameter ratios between 1:2 and 1:5, with 1:3 a starting point in those tests. Excessive flattening also distorts the print. These are machine/material-dependent craft observations, not universal constants. A layered surface is normal; the important distinction is a continuous, compressed wall with visible grooves rather than independent ropes.

### 2. Deposition cross-sections with experimental validation

**Tu et al., Numerical Prediction and Experimental Validation of Deposited Filaments in Direct Ink Writing: Deposition Status and Profile Dimension (2025), Polymers 17(5), 573.**

- [Open article](https://pmc.ncbi.nlm.nih.gov/articles/PMC11902750/)
- [DOI: 10.3390/polym17050573](https://doi.org/10.3390/polym17050573)

Uses OpenFOAM v1912, 3D VOF free-surface tracking and a regularized Herschel–Bulkley law, including gravity, surface tension and substrate conditions. The test ink is a commercial microcrystalline-wax-based cream, **not pottery clay**. The article reports maximum width/height relative errors of 10.13%/7.37% for the evaluated non-over-deposited cases. It relates filament dimensions and deposition regimes to nozzle clearance and travel/extrusion speeds.

Use this to design single-filament and nozzle-gap validation cases. Do not copy its rheological parameters into clay, or claim it validates multilayer clay collapse. OpenFOAM is available, but no study-specific downloadable cases were established from the article.

### 3. New layers deform old layers through extrusion pressure as well as weight

**Mollah et al., Computational analysis of yield stress buildup and stability of deposited layers in material extrusion additive manufacturing (2023), Additive Manufacturing 71, 103605.**

- [Author publication page and PDF link](https://md-tusher-mollah.github.io/publication/mollah-computational-2023/)
- [DOI: 10.1016/j.addma.2023.103605](https://doi.org/10.1016/j.addma.2023.103605)

Full PDF methods checked: the solver is **FLOW-3D 12.0**, not OpenFOAM. It uses regularized Bingham rheology and TruVOF free-surface tracking. Extrusion and hydrostatic pressures together influence previously deposited wet layers; the study varies the earlier layer's yield stress to investigate shape retention. Its referenced prior single-/multilayer experimental validation concerns concrete printing. This is a useful general viscoplastic deposition model, not a ceramic-clay-specific validation.

For this project: nozzle gap, deposition rate and contact area must be part of deformation, not simply a post-deposition gravity adjustment. Increasing resistance over time also needs a defined physical cause and calibration; it should not be switched by an emotional label.

### 4. Adjacent yield-stress filaments do not necessarily merge into a smooth surface

**França et al., Coalescence of Printed Yield Stress Filaments in Direct Ink Writing (arXiv preprint, submitted 2026-01-14).**

- [Abstract](https://arxiv.org/abs/2601.09870)
- [Full HTML](https://arxiv.org/html/2601.09870v1)

Experiments use **Carbopol gels**, not clay. A 2D Basilisk C free-surface simulation uses an elastoviscoplastic Saramito formulation with Herschel–Bulkley behavior. Surface tension drives neck growth between adjacent strands; yield stress can arrest it, leaving grooves. The initial cross-section matters. The preprint also discusses elasticity and departures from agreement at higher yield stress. Gravity is neglected in that model, so it is not a standalone model for a tall clay wall.

This argues against both permanent independent tubes and indiscriminate visual fusion. Reconstruct a contact region only when material state/contact supports it, while retaining physically plausible layer relief. This research concerns side-by-side coalescence; it does not directly measure vertically printed clay bonding.

### 5. Reusable continuum simulation code, not a ready wet-clay printer

**PlasticineLab: A Soft-Body Manipulation Benchmark with Differentiable Physics (ICLR 2021).**

- [Repository](https://github.com/hzaskywalker/PlasticineLab)
- [Simulator source](https://github.com/hzaskywalker/PlasticineLab/blob/main/plb/engine/mpm_simulator.py)
- [Paper](https://openreview.net/pdf?id=xCcdBRQEDW)

The source implements MLS-MPM/APIC-style transfers and a von Mises plastic projection with fixed-corotated elasticity. It is useful for understanding plastic deformation of a volume. It does not provide a calibrated wet-clay extrusion inlet, moisture/thixotropic evolution or a complete printable free-surface reconstruction. Its parameters and timestep are benchmark choices, not pottery measurements. Check license and runtime requirements before adopting code.

**Fang et al., Silly Rubber: An Implicit Material Point Method for Simulating Non-equilibrated Viscoelastic and Elastoplastic Solids (SIGGRAPH 2019).**

- [DOI: 10.1145/3306346.3322968](https://doi.org/10.1145/3306346.3322968)
- [Ziran2019 reference implementation](https://github.com/penn-graphics-research/ziran2019)

An MIT-licensed general MPM codebase for viscoelastic/elastoplastic deformation, with related fracture examples. It is not wet-clay-printing software. Its usefulness is the continuum formulation and constitutive-model reference, not immediate integration into Three.js.

## Recommended next experiment

1. Choose a reference clay, nozzle and extrusion conditions; obtain side and cross-section measurements where possible. Without this, describe the work as a plausible visual approximation.
2. Test a **single deposited strand**: width and height versus nozzle gap and volume per distance. Distinguish extrusion deformation from the final shaded image.
3. Test **two and three layers**: compressed interfaces, lower-layer bulging and visible layer grooves. Compare actual cross-sections, not only final vessel silhouettes.
4. Test **short/long unsupported spans and feed restart**: progressive deflection, necking, rounded start/stop deposits and accumulation without loss of volume.
5. Only then apply the emotion-driven full vessel trajectory.

For offline physical reference, a free-surface viscoplastic CFD model is the most directly supported by the deposition papers. For a large-deformation interactive prototype, MPM is worth testing, but it still needs suitable clay rheology, nozzle/deposition boundaries and a surface reconstruction pipeline. A volume/implicit-surface renderer can remove intersecting-tube artifacts, but meshing alone does not fix the material law and must not manufacture fusion across real gaps.

No new solver or physical accuracy claim is made by this research note. The current v3 remains the deployed experimental baseline; the UI reference-cylinder and language fixes are independent of the physics work.
