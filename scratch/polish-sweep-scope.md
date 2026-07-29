# UI Polish Sweep — Scoping Notes (READ-ONLY, no changes made)

State: on `main`, clean except untracked scratch/. 280 tests pass / 0 fail.

## Key source coordinates
- index.html speed groups: status (wired) lines 20-24 #speed-group; extra (dead+display:none) lines 28-33
- speed handler: js/main.js:751-759 (only #speed-group)
- header__transport-extra CSS display:none: css/style.css:269-271
- status speed ::after label: css/style.css:328-338 (font-size:0 hides mojibake text)
- btn-loops: index.html:34; handler js/main.js:767-784; CSS transport-btn 273-303, --active 592
- trigger cluster: index.html:160-185; display logic js/main.js:670-701; CSS 1132-1142
- pplat getter (always computed): js/ventilator.js:618-628; holdActive getter 291; summary pplat_cmH2O 1253
- param-pplat render (ungated): js/main.js:1013; hold-results gated: js/main.js:1484-1503
- pmus cluster: index.html:326-352; handlers js/main.js:460-509; CSS 1088-1130 (PR-A area)
- pmus dup value: #pmus-display (484/496) vs #pmus-max-display (495)
- pinsp label: index.html:90-97 ("Pinsp above PEEP")
- timing box: index.html:458-474 (VT,VE,Vinsp); syncMonitorLayout js/main.js:1329-1364 (reorders to RR,VE,VT)
- param-row--large font: css/style.css:760-762 (26px) / teaching 854-861 (28px); plain 680 (17px)/teaching 850 (20px)
- W1 RED labels: tests/test-engine.js:2503,2520,2577 (NT1 already fixed @2467)
- W2 mojibake: test-engine.js 177,2144,2162,2181,2200,2219,2238,2257 (â€”); index.html 21-23 (Ã—), 423 (â€”)
- W3 dead CSS: css/style.css:695-707 (.rr-actual/.rr-set-secondary), only in CSS, no emitters
- W4: no .gitattributes; core.autocrlf=true; index i/lf w/crlf
