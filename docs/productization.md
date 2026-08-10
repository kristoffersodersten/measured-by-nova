# Productization Plan

## Product Thesis

Measured by Nova is sold as a measurement-driven reconstruction and digital
viewing system, not as CAD software and not as image beautification.

The commercial value is the controlled workflow:

```text
verified capture -> deterministic model -> reviewed lock -> recipient-specific export
```

The first paid product can remain deliberately narrow, but the product boundary
is broader than facade documentation. The commercial destination is high-trust
digital viewing for physical assets where exact dimensions, material quality,
wear, defects, and spatial feeling must be visible.

## Sellable MVP

### Initial Offer

```text
Facade Completion Pack
```

The customer provides measurements, photos, and material notes. Measured by Nova creates a reviewed 3D visualization model and exports a permit-support documentation pack.

### Broader Offer

```text
Measured Digital Viewing Pack
```

The customer provides exact measurements, structured photos, material notes, and
condition evidence. Measured creates a reviewed real-scale Blender model,
photorealistic preview renders, web/spatial assets where applicable, and a
traceable material/condition report.

### Target Customers

- Homeowners preparing small exterior permit/completion documents
- Small builders and carpenters
- Drafting consultants who want faster measured visualizations
- Real estate and renovation operators with repeatable small structures
- Car dealerships that need inspectable vehicle condition and scale
- Boat dealerships that need hull, deck, cabin, material and wear visibility
- Brokers and operators who sell physical assets where trust depends on exact
  representation rather than flattering photos

### First Supported Project Types

1. Carport
2. Shed
3. Deck or terrace
4. Small exterior extension with simple facade geometry
5. Vehicle exterior/interior digital viewing capture
6. Boat hull/deck/cabin digital viewing capture
7. Room/property digital viewing capture

Do not expand project types until the carport flow is repeatable end-to-end.
For later profiles, reuse the same source-of-truth model instead of creating
domain-specific shortcuts.

## Paid Boundary

### Open Core

Keep public:

- MCP server
- measurement schema
- capture contract
- capability manifest
- generic Blender bridge
- generic profile generation
- synthetic fixtures
- deterministic tests

### Paid / Controlled

Keep private or commercially licensed:

- guided capture UX
- municipality-specific templates
- dealership/showroom templates
- photorealistic rendering presets
- material and defect QA workflows
- customer-ready PDF styling
- QA checklist workflows
- batch project workflows
- real customer examples
- service delivery playbooks

## First Customer Workflow

1. Intake
   - project type
   - property/project metadata
   - recipient template

2. Capture
   - required measurements
   - four facade photos where relevant
   - 360-degree coverage where digital viewing is the target
   - close-ups of materials, edges, seams, defects, damage, and wear
   - material and color notes
   - assumptions explicitly marked

3. Contract validation
   - block unverified geometry
   - block missing required facade evidence
   - preserve confidence semantics

4. Model generation
   - generate measured Blender model
   - apply visible material representation and PBR material metadata
   - generate preview renders

5. Human review
   - user approves geometry
   - model lock is recorded

6. Export
   - facade pack
   - digital viewing pack
   - photorealistic preview renders
   - web/spatial asset where applicable
   - measurement list
   - material and condition report
   - confidence legend
   - assumptions and limitations

7. Delivery
   - PDF package
   - optional `.blend` and PNG views
   - project JSON manifest

## Pricing Hypothesis

Test simple service/product pricing before building a full SaaS:

| Package | Price Hypothesis | Scope |
| --- | ---: | --- |
| Single facade pack | 995-2495 SEK | One small structure, one export package |
| Digital viewing pack | 2495-9995 SEK | One physical asset with reviewed Blender model and renders |
| Builder monthly | 499-1499 SEK/month | Repeat exports and stored templates |
| Dealer monthly | 1499-9995 SEK/month | Repeat captures, renders, and web/spatial assets |
| Consultant workflow | Custom | Batch/customer delivery and QA |

Do not optimize pricing before validating willingness to pay with 3-5 real cases.

## Go-To-Market Slice

Start with a service-assisted product:

```text
Send measurements + photos -> receive reviewed 3D model + permit-support facade package.
```

This avoids premature UI work and exposes the real bottlenecks:

- capture quality
- missing measurements
- model review friction
- export acceptance
- customer language

For the broader market:

```text
Send measurements + structured photos -> receive reviewed 3D model + digital viewing assets.
```

This exposes the next bottlenecks:

- capture repeatability
- material evidence quality
- defect/wear visibility
- buyer-trust language
- render realism without overclaiming

## Product Quality Gates

The product may be sold only when these are true:

- capture-to-fixture conversion works for at least one real case
- all geometry-impacting fields are verified or blocked
- same input and capability manifest produce stable manifests
- Blender output is reviewed before export
- export package does not reconstruct geometry
- photorealistic output is generated from locked geometry and source-backed
  material evidence
- UI/UX follows NovaChat's MUE and Environment Truth contracts
- execution remains subordinate to Namaka/Axiome governance boundaries
- docs clearly state non-CAD/non-approval boundary
- customer data is kept out of the public repository

## Release Milestones

### M0: Public Core Stabilization

- Commit and push current open-core branch.
- Rename repository to `measured-by-nova`.
- Keep generated outputs and real photos out of public git.
- Keep `pnpm lint && pnpm test && pnpm build` green.

### M1: Service-Assisted Pilot

- Create one private real capture package.
- Run capture-to-fixture.
- Generate Blender model.
- Human-review and lock.
- Export facade pack.
- Record blockers in a private delivery log.

### M2: Repeatable Paid Workflow

- Add a guided intake checklist.
- Add one polished paid PDF template.
- Add customer delivery checklist.
- Add versioned output manifest per delivery.

### M3: Product UI

- Build a minimal local-first UI only after the assisted workflow repeats.
- UI should expose system state, capture state, validation state, and export state.
- UI must not hide confidence or assumptions.
- UI should inherit NovaChat visual and interaction principles.

### M4: Digital Viewing Pilot

- Create one private vehicle, boat, or property capture package.
- Define exact dimensional and material capture contract.
- Generate reviewed Blender model.
- Produce photorealistic preview renders from locked geometry.
- Export GLB/USDZ where appropriate.
- Produce material and condition manifest.

## Immediate Backlog

1. Repository readiness
   - verify public/private boundary
   - remove or ignore generated outputs
   - push open-core branch
   - rename GitHub repo when ready

2. Capture pipeline
   - add project metadata fields
   - add material/color metadata contract
   - add capture completeness report

3. Export package
   - make `gothenburg-permit` a controlled template boundary
   - add title block metadata schema
   - add measurement list export
   - add assumption/limitation section

4. Rendering
   - separate permit exports from marketing renders
   - mark photorealistic rendering as preview/marketing only unless separately validated
   - add PBR material contract
   - add defect/wear annotations
   - add deterministic render manifest

5. Commercial workflow
   - private customer data folder outside repo
   - delivery checklist
   - pricing experiment

6. Governance and UX
   - add Namaka alignment gate
   - add Axiome-style intent/action manifest boundary
   - add NovaChat-derived UI/UX contract
   - expose environment truth in future UI

## Anti-Goals

- Do not build a generic CAD replacement.
- Do not promise approval.
- Do not infer missing geometry.
- Do not make photorealism part of permit truth or geometry truth.
- Do not hide defects, wear, uncertainty, or low-confidence material evidence.
- Do not build UI that diverges from NovaChat/MUE without passing the feature
  adoption test.
- Do not build SaaS before the assisted workflow works.
