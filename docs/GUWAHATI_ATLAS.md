# Guwahati atlas and Six Mile district

## Scope and reference

The application opens to an illustrative Guwahati city atlas. The user's two attached screenshots guide the overview and Six Mile street composition. No map tiles, personal records, external map API or paid service is used. This feature adds no API charges; it renders locally using the existing three.js dependency.

The overview echoes the broad Brahmaputra corridor, western wetland and southern/eastern hills. It is a stylised overview, not a surveyed city model. Pins identify Six Mile and Paltan Bazaar. Biswanath Town is shown in a regional inset because Biswanath Chariali is a separate town in Assam, not a Guwahati neighbourhood. See the [municipal board's description](https://biswanathchariali.assamurban.in/about-us).

Six Mile follows the second image's diagonal arterial, western perimeter, southern edge, winding channel, residential lanes, APDCL campus and GNRC hospital landmark. The image's channel name is not independently verified, so the model calls it a channel. No exact elevations, parcel dimensions, flood probabilities or real service capacities are claimed.

The district is compressed into 128 × 128 cells at the existing 4 m/cell contract scale (512 × 512 m). It does not reproduce the actual extent of the whole Six Mile locality. Housing, shops, apartments, foliage, road widths and building volumes are generated. The response post, relief hall, power yard, boat landing, coordination hub, landing pad and fire station are explicitly added simulation structures, not verified real facilities. Paltan Bazaar and Biswanath have selectable overview previews; detailed district generation remains future work.

## Architecture and separation

- `src/editor/geography/sixMile.ts` deterministically constructs the existing `Scenario` contract and local presentation metadata. No shared contracts are changed.
- `src/render/geography/GeographyRenderer.ts` is a separate read-only atlas renderer, using instanced geometry, orthographic projection, static lighting, orbit/pan/zoom controls, projected DOM labels and building picking. It does not change the simulation renderer or outcomes.
- `src/shell/geography/GeographyApp.tsx` owns accessible location/landmark lists, labels, building details, routing and JSON export. The map has a graceful WebGL error state; the location lists and JSON export remain usable.
- `src/shell/geography/SixMileSimulation.tsx` waits for the existing sandbox worker handshake, then loads the generated district through the existing editor store. The sandbox shell, worker, simulator and event showcase are untouched. The district opens in edit mode; the existing controls start a run.
- `/` opens the overview; `/six-mile` opens the detailed model; `/six-mile/simulate` loads that exact model into the current sandbox; `/sandbox` preserves the original test-city entry point.

The atlas is independent of the other agent's flood showcase, day/night, pedestrians and rescue-event work. In particular, no claims are made here that those simulation behaviours have been repaired. Simulation labels continue to use the sandbox's current naming system; the atlas carries the reference names in its own local metadata.

## Execution steps

1. Install the repository's dependencies with the configured pnpm version, if they are not already installed.
2. Run `pnpm dev` and open the address printed by Next.js. The Guwahati overview is the initial screen.
3. Select the Six Mile, Paltan Bazaar or Biswanath entry or map pin. The latter two show location previews and their planned status.
4. Choose **Explore Six Mile**. Drag to pan, scroll or use +/− to zoom, and right-drag to orbit. Reset restores the initial framing.
5. Select a building or a landmark in the list. Its detail card distinguishes reference landmarks from generated additions. Labels can be hidden with the Labels control.
6. Choose **Download editable city JSON** to export the same `Scenario` that the simulator consumes.
7. Choose **Open in simulator**. The district loads into the existing editor after the worker is ready. Use the current scenario controls to select the engine and run the weather timeline.
8. Use **Test sandbox** to access the other agent's showcase city at `/sandbox`.

## Validation

Run `pnpm exec vitest run src/editor/geography/sixMile.test.ts`, `pnpm typecheck` and `pnpm lint`. Tests check deterministic output, schema/editor compatibility, non-overlapping level footprints, a single connected road network, adjacent road entrances, explicit bridge decks, valid water sources, connected power loads and reference/addition provenance. Browser checks verified desktop/mobile navigation, map rendering, landmark picking, labels and sandbox loading. The integrated preview run advanced past 260 simulated seconds and paused normally. Exported JSON uses the same schema-validated scenario; the in-app browser’s download-event automation did not return a file path, so native download completion was not independently confirmed.

Future work: surveyed/licensed geometry ingestion, a larger multi-chunk Six Mile district, detailed Paltan Bazaar and Biswanath layouts, and source-backed terrain/hydrology. These require separate data validation and are outside this image-inspired model.
