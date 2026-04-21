.pragma library

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum)
}

function compareFixtures(left, right) {
    const addressDelta = Number(left && left.dmxStartAddress ? left.dmxStartAddress : 0)
                         - Number(right && right.dmxStartAddress ? right.dmxStartAddress : 0)
    if (addressDelta !== 0) {
        return addressDelta
    }

    return String(left && left.name ? left.name : "").localeCompare(String(right && right.name ? right.name : ""))
}

function sortedFixtures(fixtures) {
    const items = (fixtures || []).slice()
    items.sort(compareFixtures)
    return items
}

function groupNameById(groups, groupId) {
    if (!groupId) {
        return "Ungrouped"
    }

    const items = groups || []
    for (let index = 0; index < items.length; index += 1) {
        if (items[index].id === groupId) {
            return items[index].name
        }
    }

    return groupId
}

function groupFixtureCount(fixtures, groupId) {
    const items = fixtures || []
    let count = 0
    for (let index = 0; index < items.length; index += 1) {
        if ((items[index].groupId || "") === (groupId || "")) {
            count += 1
        }
    }
    return count
}

function fixtureSections(fixtures, groups) {
    const sections = []
    const groupedFixtures = {}
    const orderedFixtures = sortedFixtures(fixtures)
    for (let index = 0; index < orderedFixtures.length; index += 1) {
        const fixture = orderedFixtures[index]
        const key = fixture.groupId ? fixture.groupId : "__ungrouped__"
        if (!groupedFixtures[key]) {
            groupedFixtures[key] = []
        }
        groupedFixtures[key].push(fixture)
    }

    const groupItems = groups || []
    for (let groupIndex = 0; groupIndex < groupItems.length; groupIndex += 1) {
        const group = groupItems[groupIndex]
        const groupFixtures = groupedFixtures[group.id] || []
        if (!groupFixtures.length) {
            continue
        }

        sections.push({
            "id": group.id,
            "name": group.name,
            "fixtures": groupFixtures,
            "fixtureCount": groupFixtures.length,
            "liveCount": liveFixtureCount(groupFixtures)
        })
    }

    const ungroupedFixtures = groupedFixtures.__ungrouped__ || []
    if (ungroupedFixtures.length) {
        sections.push({
            "id": "__ungrouped__",
            "name": "Ungrouped",
            "fixtures": ungroupedFixtures,
            "fixtureCount": ungroupedFixtures.length,
            "liveCount": liveFixtureCount(ungroupedFixtures)
        })
    }

    return sections
}

function liveFixtureCount(fixtures) {
    let count = 0
    const items = fixtures || []
    for (let index = 0; index < items.length; index += 1) {
        if (items[index].on) {
            count += 1
        }
    }
    return count
}

function sectionPowerState(fixtures) {
    const liveCount = liveFixtureCount(fixtures)
    const total = (fixtures || []).length
    if (total === 0 || liveCount === 0) {
        return {
            "label": "OFF",
            "color": "#8d8da5",
            "backgroundColor": "#242430"
        }
    }

    if (liveCount === total) {
        return {
            "label": "ON",
            "color": "#d7ffea",
            "backgroundColor": "#163a2c"
        }
    }

    return {
        "label": "PARTIAL",
        "color": "#f8deb2",
        "backgroundColor": "#3a2b18"
    }
}

function cctPresetOptions(minimum, maximum) {
    const candidates = [
        { "label": "Tungsten", "value": 3200, "color": "#ff9329", "bordered": false },
        { "label": "Halogen", "value": 3400, "color": "#ffab4a", "bordered": false },
        { "label": "Fluorescent", "value": 4200, "color": "#ffe0b5", "bordered": false },
        { "label": "Daylight", "value": 5600, "color": "#fff5e6", "bordered": false },
        { "label": "Overcast", "value": 6500, "color": "#d6e4f0", "bordered": false },
        { "label": "Shade", "value": 7500, "color": "#b8cfe0", "bordered": false },
        { "label": "Full CTO", "value": 3200, "color": "#ff8c00", "bordered": true },
        { "label": "1/2 CTO", "value": 3800, "color": "#ffab4a", "bordered": true },
        { "label": "1/4 CTO", "value": 4400, "color": "#ffc980", "bordered": true },
        { "label": "1/4 CTB", "value": 5200, "color": "#e8eef5", "bordered": true },
        { "label": "1/2 CTB", "value": 6500, "color": "#c4d6ea", "bordered": true },
        { "label": "Full CTB", "value": 8000, "color": "#8db4d9", "bordered": true }
    ]
    const presets = []
    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]
        if (candidate.value >= minimum && candidate.value <= maximum) {
            presets.push(candidate)
        }
    }
    return presets
}

function fixtureColorModeLabel(fixture) {
    const colorMode = String(fixture && fixture.colorMode ? fixture.colorMode : "cct").toLowerCase()
    switch (colorMode) {
    case "rgb":
        return "RGB"
    case "hsi":
        return "HSI"
    default:
        return "CCT"
    }
}

function fixtureTypeBadgeLabel(typeId) {
    switch (String(typeId || "")) {
    case "astra-bicolor":
        return "Astra"
    case "infinibar-pb12":
        return "Infinibar"
    case "infinimat":
        return "Infinimat"
    default:
        return String(typeId || "Fixture")
    }
}

function fixtureAccentColor(fixture) {
    const item = fixture || {}
    return kelvinToColor(Number(item.cct || 5600))
}

// Canonical CCT→color ramp (v2.2). Preserves three anchor hues from prior
// ad-hoc copies and linearly interpolates between them in sRGB space.
// Anchors: 2700 K → #ff8a3c, 3200 K → #ffb35c, 4400 K → #ffd38b,
//          5600 K → #fff5e6, 6500 K → #eaf0ff.
function kelvinToColor(k) {
    const value = Number.isFinite(k) ? k : 5600
    const stops = [
        { "k": 2700, "r": 0xff, "g": 0x8a, "b": 0x3c },
        { "k": 3200, "r": 0xff, "g": 0xb3, "b": 0x5c },
        { "k": 4400, "r": 0xff, "g": 0xd3, "b": 0x8b },
        { "k": 5600, "r": 0xff, "g": 0xf5, "b": 0xe6 },
        { "k": 6500, "r": 0xea, "g": 0xf0, "b": 0xff }
    ]

    if (value <= stops[0].k) {
        return Qt.rgba(stops[0].r / 255, stops[0].g / 255, stops[0].b / 255, 1)
    }
    const last = stops[stops.length - 1]
    if (value >= last.k) {
        return Qt.rgba(last.r / 255, last.g / 255, last.b / 255, 1)
    }

    for (let index = 0; index < stops.length - 1; index += 1) {
        const lo = stops[index]
        const hi = stops[index + 1]
        if (value >= lo.k && value <= hi.k) {
            const t = (value - lo.k) / (hi.k - lo.k)
            const r = lo.r + (hi.r - lo.r) * t
            const g = lo.g + (hi.g - lo.g) * t
            const b = lo.b + (hi.b - lo.b) * t
            return Qt.rgba(r / 255, g / 255, b / 255, 1)
        }
    }
    return Qt.rgba(1, 1, 1, 1)
}

function effectOptions() {
    return [
        { "id": "pulse", "label": "Pulse" },
        { "id": "strobe", "label": "Strobe" },
        { "id": "candle", "label": "Candle" }
    ]
}

function firstUnplacedFixtureId(fixtures) {
    const items = sortedFixtures(fixtures)
    for (let index = 0; index < items.length; index += 1) {
        const fixture = items[index]
        if (fixture.spatialX === undefined || fixture.spatialX === null
                || fixture.spatialY === undefined || fixture.spatialY === null) {
            return fixture.id
        }
    }

    return ""
}

function nextFixtureId(fixtures, currentId, step) {
    const items = sortedFixtures(fixtures)
    if (!items.length) {
        return ""
    }

    let currentIndex = 0
    if (currentId) {
        for (let index = 0; index < items.length; index += 1) {
            if (items[index].id === currentId) {
                currentIndex = index
                break
            }
        }
    }

    const direction = step < 0 ? -1 : 1
    const nextIndex = (currentIndex + direction + items.length) % items.length
    return items[nextIndex].id
}

function clampContextMenuPosition(x, y, viewportWidth, viewportHeight, menuWidth, menuHeight, padding) {
    const safePadding = padding === undefined ? 12 : padding
    return {
        "x": clamp(x, safePadding, Math.max(safePadding, viewportWidth - menuWidth - safePadding)),
        "y": clamp(y, safePadding, Math.max(safePadding, viewportHeight - menuHeight - safePadding))
    }
}

function resolvedFixtures(fixtures) {
    const items = sortedFixtures(fixtures)
    const unresolved = []
    for (let index = 0; index < items.length; index += 1) {
        const fixture = items[index]
        if (fixture.spatialX === undefined || fixture.spatialX === null
                || fixture.spatialY === undefined || fixture.spatialY === null) {
            unresolved.push(fixture.id)
        }
    }

    const columns = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(Math.max(unresolved.length, 1)))))
    const rows = Math.max(1, Math.ceil(unresolved.length / columns))
    const suggestions = {}
    for (let index = 0; index < unresolved.length; index += 1) {
        const column = index % columns
        const row = Math.floor(index / columns)
        suggestions[unresolved[index]] = {
            "x": columns === 1 ? 0.5 : 0.18 + (column / Math.max(columns - 1, 1)) * 0.64,
            "y": rows === 1 ? 0.52 : 0.28 + (row / Math.max(rows - 1, 1)) * 0.34
        }
    }

    const resolved = []
    for (let fixtureIndex = 0; fixtureIndex < items.length; fixtureIndex += 1) {
        const fixture = items[fixtureIndex]
        const fallback = suggestions[fixture.id] || { "x": 0.5, "y": 0.5 }
        resolved.push({
            "id": fixture.id,
            "fixture": fixture,
            "resolvedX": fixture.spatialX === undefined || fixture.spatialX === null ? fallback.x : fixture.spatialX,
            "resolvedY": fixture.spatialY === undefined || fixture.spatialY === null ? fallback.y : fixture.spatialY
        })
    }

    return resolved
}

function fitTransform(fixtures, selectedIds, viewportWidth, viewportHeight) {
    const resolved = resolvedFixtures(fixtures)
    if (!resolved.length || viewportWidth <= 0 || viewportHeight <= 0) {
        return { "zoom": 1, "panX": 0, "panY": 0 }
    }

    const selectedLookup = {}
    const ids = selectedIds || []
    for (let idIndex = 0; idIndex < ids.length; idIndex += 1) {
        selectedLookup[ids[idIndex]] = true
    }

    const targets = []
    for (let index = 0; index < resolved.length; index += 1) {
        if (!ids.length || selectedLookup[resolved[index].id]) {
            targets.push(resolved[index])
        }
    }

    const points = targets.length ? targets : resolved
    let minX = viewportWidth
    let maxX = 0
    let minY = viewportHeight
    let maxY = 0

    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex]
        const x = point.resolvedX * viewportWidth
        const y = point.resolvedY * viewportHeight
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
    }

    if (points.length === 1) {
        minX -= 90
        maxX += 90
        minY -= 70
        maxY += 70
    }

    const padding = 56
    const boundsWidth = Math.max(140, maxX - minX)
    const boundsHeight = Math.max(120, maxY - minY)
    const zoom = clamp(
        Math.min((viewportWidth - padding * 2) / boundsWidth, (viewportHeight - padding * 2) / boundsHeight),
        0.85,
        2.4
    )
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    return {
        "zoom": zoom,
        "panX": viewportWidth / 2 - centerX * zoom,
        "panY": viewportHeight / 2 - centerY * zoom
    }
}
