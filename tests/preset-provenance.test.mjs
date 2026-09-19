// Independent owner-approved oracle, frozen from D1-D13 on 2026-09-18.
// No expected value is read from production presets. Do not use the legacy
// relative-or-0.01 helper for these exact compliance assertions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const ORACLE = [
    {
        "key": "normal",
        "label": "Normal example",
        "note": "Illustrative starting values: R = 10 cmH₂O·s/L; C = 60 mL/cmH₂O. Calculated τ = 0.60 s. This pair is a project example, not Arnal's recommended Normal pair.",
        "resistance": 10,
        "compliance": 0.06,
        "tau": 0.6
    },
    {
        "key": "ards_moderate",
        "label": "Low compliance (35)",
        "note": "Illustrative starting values: R = 10 cmH₂O·s/L; C = 35 mL/cmH₂O. Calculated τ = 0.35 s. The name describes the configured compliance, not ARDS severity.",
        "resistance": 10,
        "compliance": 0.035,
        "tau": 0.35
    },
    {
        "key": "ards_severe",
        "label": "Low compliance (25)",
        "note": "Illustrative starting values: R = 12 cmH₂O·s/L; C = 25 mL/cmH₂O. Calculated τ = 0.30 s. The name describes the configured compliance, not ARDS severity.",
        "resistance": 12,
        "compliance": 0.025,
        "tau": 0.3
    },
    {
        "key": "copd",
        "label": "COPD example (HME)",
        "note": "Starting values: R = 25 cmH₂O·s/L; C = 60 mL/cmH₂O. Calculated τ = 1.50 s. This pair follows Arnal et al. (2018), Table 9, for a COPD simulation with a heat-and-moisture exchanger (HME). The study measured passive, intubated adults in one ICU and excluded BMI above 30 and mixed lung conditions. The model uses combined resistance; it does not simulate the HME separately.",
        "resistance": 25,
        "compliance": 0.06,
        "tau": 1.5
    },
    {
        "key": "asthma",
        "label": "High resistance (20)",
        "note": "Illustrative starting values: R = 20 cmH₂O·s/L; C = 60 mL/cmH₂O. Calculated τ = 1.20 s. This example explores increased resistance; it is not a validated acute-asthma preset.",
        "resistance": 20,
        "compliance": 0.06,
        "tau": 1.2
    },
    {
        "key": "obesity",
        "label": "Reduced compliance (40)",
        "note": "Illustrative starting values: R = 8 cmH₂O·s/L; C = 40 mL/cmH₂O. Calculated τ = 0.32 s. This example changes total respiratory-system compliance. It does not identify a chest-wall cause or represent validated obesity mechanics.",
        "resistance": 8,
        "compliance": 0.04,
        "tau": 0.32
    },
    {
        "key": "fibrosis",
        "label": "Low compliance (30)",
        "note": "Illustrative starting values: R = 8 cmH₂O·s/L; C = 30 mL/cmH₂O. Calculated τ = 0.24 s. This example explores reduced compliance; it is not a validated pulmonary-fibrosis preset.",
        "resistance": 8,
        "compliance": 0.03,
        "tau": 0.24
    }
];
export const COPY = {
    "disclosure": "Simulation examples; not disease reference values.",
    "description": "Selecting an example changes R and C and keeps the other settings and simulation history. Editing R or C creates custom mechanics. The selector retains the last loaded example.",
    "custom": "R or C has been edited. The controls show the current mechanics; the selected example identifies the last starting values loaded.",
    "common": "An example loads starting resistance (R) and compliance (C). R combines airway and tube resistance in one value. C describes the total respiratory system; this model does not separate lung and chest-wall compliance. The displayed time constant is calculated as τ = R × C. It is not a measured expiratory time constant. These examples do not define a diagnosis or its severity. Manual control limits are for exploring the model, not clinical reference ranges.",
    "units": "R is in cmH₂O·s/L. C is displayed in mL/cmH₂O and converted to L/cmH₂O for calculations. With C in L/cmH₂O, R × C gives seconds.",
    "tau": "Calculated from the current configured R and C. This is the time constant of the linear single-compartment model."
};

export async function verify(root = '.') {
    root = path.resolve(root);
    const {LungModel} = await import(pathToFileURL(path.join(root, 'js/lung-model.js')));
    const checks = [];
    const eq = (id, actual, expected) => {
        try { assert.deepStrictEqual(actual, expected, id); checks.push({id,ok:true}); }
        catch (error) { checks.push({id,ok:false}); throw error; }
    };
    try {
        const presets = LungModel.presets();
        eq('keys.exact', Object.keys(presets), ORACLE.map(r => r.key));
        eq('constructor.R', new LungModel().resistance, 10);
        eq('constructor.C', new LungModel().compliance, .050);
        for (const row of ORACLE) {
            const preset = presets[row.key], model = LungModel.fromPreset(row.key);
            for (const field of ['resistance','compliance','label','note'])
                eq(row.key+'.'+field, preset[field], row[field]);
            eq(row.key+'.loadedR', model.resistance, row.resistance);
            eq(row.key+'.loadedC', model.compliance, row.compliance);
            eq(row.key+'.calculatedTau', model.timeConstant, row.resistance * row.compliance);
            eq(row.key+'.reportedPrecision', model.timeConstant.toFixed(2), row.tau.toFixed(2));
            eq(row.key+'.units', model.compliance * 1000, Math.round(row.compliance * 1000));
        }
        const lungSource=fs.readFileSync(path.join(root,'js/lung-model.js'),'utf8');
        eq('provenance.noBlanketAttribution', /Each preset represents a typical|Based on Arnal|clinically representative/.test(lungSource), false);
        eq('provenance.COPD-HME', lungSource.includes('Table 9, COPD with HME.'), true);
        const modelDoc=fs.readFileSync(path.join(root,'docs/model.md'),'utf8');
        eq('docs.noIsolatedTubeClaim', modelDoc.includes('The source does not establish a separate 5–8 cmH₂O·s/L tube contribution for these examples.'), true);
        eq('docs.explorationLimits', modelDoc.includes('Manual exploration limits are R = 5–40 cmH₂O·s/L and C = 15–100 mL/cmH₂O. These are project input limits, not validated disease-reference ranges.'), true);
        eq('docs.totalSystem', modelDoc.includes('The model does not separate lung and chest-wall mechanics or simulate humidification hardware.'), true);
        for (const row of ORACLE) {
            eq(row.key+'.modelDoc',modelDoc.includes('| '+row.label+' | '+row.resistance+' | '+Math.round(row.compliance*1000)+' | '+row.tau.toFixed(2)+' |'),true);
            eq(row.key+'.schemaDoc',fs.readFileSync(path.join(root,'docs/case-design-schema.md'),'utf8').includes('| '+row.key+' | '+row.label+' |'),true);
        }
        const cases=fs.readFileSync(path.join(root,'docs/case-bank-v0.1.md'),'utf8');
        eq('docs.casesRemainDraft',cases.includes('Clinical case narratives, interventions and expected clinical interpretations remain draft and require separate VSM-CLIN-010 review.'),true);
        eq('docs.case4BothChange',cases.includes('This example switch changes R from 10 to 12 cmH₂O·s/L as well as C from 60 to 25 mL/cmH₂O; it is not an isolated compliance change.'),true);
    } catch (error) {
        if (!checks.some(c => !c.ok)) checks.push({id:'INFRA.completed-run',ok:false,detail:error.message});
        console.error(error.message);
    }
    if (!checks.some(c => !c.ok) && checks.length !== 87) {
        checks.push({id:'INFRA.exact-tally',ok:false,detail:checks.length});
    }
    const result={passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length,checks};
    console.log(JSON.stringify(result));
    return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const result=await verify(process.argv[2]);
    if(result.failed)process.exitCode=1;
}
