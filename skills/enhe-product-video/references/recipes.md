# Recipe selection

Recipes define shot structure, not product conclusions. Open the selected `recipes/*.v1.json` and satisfy its required inputs before using it.

| Recipe | Select when | Skip or replace when |
|---|---|---|
| `hero-hook.v1` | A product name and evidenced outcome can appear in the first three seconds. | Identity or outcome is not verified. |
| `problem-solution.v1` | One audience problem maps directly to the product value. | The problem is speculative or inflated. |
| `feature-focus.v1` | One feature has a benefit and matching evidence asset. | Multiple features would compete or evidence is missing. |
| `ui-walkthrough.v1` | A real screenshot/recording demonstrates an action and result. | Only invented UI or private/restricted material is available. |
| `before-after.v1` | Both workflow states can be compared fairly from evidence. | The contrast requires a straw man or unsourced numbers. |
| `social-proof.v1` | A claim, quote, metric, logo, and attribution are sourced and authorized. | Any proof or usage right is unresolved; omit the scene. |
| `cta.v1` | One verified action and destination close the story. | The offer, destination, or urgency is unsupported. |
| `product-promo-45s.v1` | Compose a 30–60 second, 5–8 scene promotion. | Critical product facts or asset rights are missing. |

The default composite sequence is hero, problem/solution, feature, UI walkthrough, another feature or before/after comparison, then CTA. Adapt the choice and duration to the evidence, output locale, and audio timing. Social proof is optional and never generated to fill time.

Record recipe IDs and semantic versions in `video-spec.json` and `run-report.json`. A recipe fallback is an explicit degraded path; note its cause and effect in the storyboard and QA report.
