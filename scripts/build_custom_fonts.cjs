const fs = require("fs")
const path = require("path")

const opentype = require(path.join(__dirname, "..", "src", "js", "opentype.min.js"))

const KNOWN_FEATURES = ["ss01", "ss02", "ss03", "ss04", "ss05"]
const KNOWN_ALTERNATES = ["cv01", "cv02", "cv03", "cv04", "cv05", "cv06", "cv07", "cv08", "cv09", "cv10", "cv11"]

function parseList(value) {
    if (!value) return []
    return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
}

function toNumber(name, value) {
    const numberValue = Number(value)
    if (!Number.isFinite(numberValue)) {
        throw new Error(`Invalid ${name}: ${JSON.stringify(value)}`)
    }
    return numberValue
}

function getRepoRoot() {
    return path.join(__dirname, "..")
}

function detectCommitMonoVersion(fontlabDir) {
    const entries = fs.readdirSync(fontlabDir)
    const versions = new Map()

    for (const filename of entries) {
        const match = filename.match(/^CommitMono(V\d+)-(\d+)(Italic|Regular)\.otf$/)
        if (!match) continue
        const versionTag = match[1]
        const versionNumber = Number(versionTag.slice(1))
        if (!Number.isFinite(versionNumber)) continue
        versions.set(versionNumber, versionTag)
    }

    const sorted = [...versions.entries()].sort((a, b) => a[0] - b[0])
    const latest = sorted.at(-1)
    if (!latest) {
        throw new Error(`Could not detect Commit Mono version from ${fontlabDir}`)
    }
    return latest[1]
}

function buildBooleanMap(knownTags, enabledTags) {
    const enabled = new Set(enabledTags)
    for (const tag of enabled) {
        if (!knownTags.includes(tag)) {
            throw new Error(`Unknown tag: ${tag} (expected one of: ${knownTags.join(", ")})`)
        }
    }
    return Object.fromEntries(knownTags.map((tag) => [tag, enabled.has(tag)]))
}

function sliceArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

function bakeAlternatesBySwappingPaths(font, alternates) {
    const gsub = font?.tables?.gsub
    if (!gsub?.features || !gsub?.lookups) return

    Object.entries(alternates).forEach(([alternate, active]) => {
        if (!active) return

        gsub.features.forEach((feature) => {
            if (feature.tag !== alternate) return

            feature.feature.lookupListIndexes.forEach((lookupIndex) => {
                const lookup = gsub.lookups[lookupIndex]
                if (!lookup?.subtables) return

                lookup.subtables.forEach((subtable) => {
                    if (!subtable?.coverage) return

                    let glyphs = []
                    if (subtable.coverage.format === 1) {
                        glyphs = subtable.coverage.glyphs
                    }
                    if (subtable.coverage.format === 2) {
                        glyphs = subtable.coverage.ranges
                            .map((range) =>
                                Array.from(Array(range.end - range.start + 1)).map((_, index) => range.start + index)
                            )
                            .flat()
                    }

                    glyphs.forEach((glyphIndexOriginal, index) => {
                        const glyphIndexSubstitute = subtable.substitute?.[index]
                        if (glyphIndexSubstitute == null) return

                        const glyphOriginal = font.glyphs.glyphs[glyphIndexOriginal]
                        const glyphSubstitute = font.glyphs.glyphs[glyphIndexSubstitute]
                        if (!glyphOriginal?.path || !glyphSubstitute?.path) return

                        const glyphPathOriginal = glyphOriginal.path
                        const glyphPathSubstitute = glyphSubstitute.path
                        glyphOriginal.path = glyphPathSubstitute
                        glyphSubstitute.path = glyphPathOriginal
                    })
                })
            })
        })
    })
}

function applyLetterSpacing(font, letterSpacing) {
    const defaultWidth = 600
    const newWidth = defaultWidth + letterSpacing * 10
    const newWidthDecrease = letterSpacing * 10
    const newWidthMoveAmount = letterSpacing * 5

    for (const glyph of Object.values(font.glyphs.glyphs)) {
        if (!glyph?.path?.commands) continue
        glyph.path.commands.forEach((command) => {
            if (command.type === "M" || command.type === "L") {
                command.x += newWidthMoveAmount
            }
            if (command.type === "C") {
                command.x += newWidthMoveAmount
                command.x1 += newWidthMoveAmount
                command.x2 += newWidthMoveAmount
            }
        })
        glyph.leftSideBearing += newWidthMoveAmount
        glyph.advanceWidth = newWidth
    }

    font.defaultWidthX = newWidth
    if (font.tables?.cff?.topDict) {
        font.tables.cff.topDict._defaultWidthX = newWidth
        if (font.tables.cff.topDict._privateDict) {
            font.tables.cff.topDict._privateDict.defaultWidthX = newWidth
        }
    }

    if (font.tables?.head) {
        font.tables.head.yMax += newWidthMoveAmount
        font.tables.head.yMin += newWidthMoveAmount
    }
    if (font.tables?.hhea) {
        font.tables.hhea.advanceWidthMax = newWidth
        font.tables.hhea.minLeftSideBearing += newWidthMoveAmount
        font.tables.hhea.minRightSideBearing += newWidthMoveAmount
        font.tables.hhea.xMaxExtent += newWidthDecrease
    }
    if (font.tables?.os2) {
        font.tables.os2.xAvgCharWidth = newWidth
    }
}

function applyLineHeight(font, lineHeight) {
    const newHeightOffset = lineHeight * 500 - 500
    font.ascender += newHeightOffset
    font.descender -= newHeightOffset

    if (font.tables?.hhea) {
        font.tables.hhea.ascender += newHeightOffset
        font.tables.hhea.descender -= newHeightOffset
    }
    if (font.tables?.os2) {
        font.tables.os2.sTypoAscender += newHeightOffset
        font.tables.os2.sTypoDescender -= newHeightOffset
        font.tables.os2.usWinAscent += newHeightOffset
        font.tables.os2.usWinDescent += newHeightOffset
    }
}

function bakeFeaturesIntoDefaultCalt(font, features) {
    const gsub = font?.tables?.gsub
    if (!gsub?.features || !gsub?.scripts) return

    const emptyCalt = { tag: "calt", feature: { featureParams: 0, lookupListIndexes: [] } }
    gsub.features.push(emptyCalt)

    const caltLookupIndexes = []

    Object.entries(features).forEach(([featureTag, active]) => {
        if (!active) return

        gsub.features.forEach((feature) => {
            if (feature.tag !== featureTag) return
            feature.feature.lookupListIndexes.forEach((lookupIndex) => caltLookupIndexes.push(lookupIndex))
        })

        gsub.features.forEach((feature) => {
            if (feature.tag !== "calt") return
            feature.feature.lookupListIndexes = caltLookupIndexes
        })
    })

    gsub.scripts.forEach((script) => {
        const defaultLangSys = script?.script?.defaultLangSys
        if (!defaultLangSys?.featureIndexes) return
        defaultLangSys.featureIndexes.push(defaultLangSys.featureIndexes.length)
    })
}

function applyNamesAndMetadata(font, { fontName, style, weight }) {
    const styleNoSpace = style.split(" ").join("")
    const fontFamily = fontName
    const fullName = `${fontName} ${style}`
    const postScriptName = `${fontName}-${styleNoSpace}`
    const uniqueID = `${font.names.windows.version.en};;${fontName}-${styleNoSpace};2023;FL820`

    font.names.macintosh.fontFamily.en = fontFamily
    font.names.macintosh.fontSubfamily.en = style
    font.names.macintosh.fullName.en = fullName
    font.names.macintosh.postScriptName.en = postScriptName
    font.names.macintosh.preferredFamily = fontFamily
    font.names.macintosh.preferredSubfamily = style

    font.names.windows.fontFamily.en = fontFamily
    font.names.windows.fontSubfamily.en = style
    font.names.windows.fullName.en = fullName
    font.names.windows.postScriptName.en = postScriptName
    font.names.windows.preferredFamily = fontFamily
    font.names.windows.preferredSubfamily = style
    font.names.windows.uniqueID.en = uniqueID

    if (font.tables?.cff?.topDict) {
        font.tables.cff.topDict.familyName = fontFamily
        font.tables.cff.topDict.fullName = fullName
        font.tables.cff.topDict.weight = weight === 700 ? "Bold" : "Regular"
        font.tables.cff.topDict.uniqueId = uniqueID
    }

    const macStyles = ["Regular", "Bold", "Italic", "Bold Italic"]
    if (font.tables?.head) {
        font.tables.head.macStyle = macStyles.indexOf(style)
    }

    if (font.tables?.hhea) {
        font.tables.hhea.numberOfHMetrics = 3
    }

    if (font.tables?.cff?.topDict) {
        font.tables.cff.topDict.isFixedPitch = 1
    }
    if (font.tables?.post) {
        font.tables.post.isFixedPitch = 1
    }

    font.tables.name = font.names

    if (font.tables?.os2) {
        font.tables.os2.usWeightClass = weight
        let fsSelection = 0
        fsSelection += style.includes("Italic") ? Math.pow(2, 0) : 0
        fsSelection += style.includes("Bold") ? Math.pow(2, 5) : 0
        font.tables.os2.fsSelection = fsSelection
    }
}

function makeCustomFont({ inputPath, fontName, weight, italic, style, alternates, features, letterSpacing, lineHeight }) {
    const fileBuffer = fs.readFileSync(inputPath)
    const font = opentype.parse(sliceArrayBuffer(fileBuffer))

    bakeAlternatesBySwappingPaths(font, alternates)
    applyLetterSpacing(font, letterSpacing)
    applyLineHeight(font, lineHeight)
    bakeFeaturesIntoDefaultCalt(font, features)
    applyNamesAndMetadata(font, { fontName, style, weight })

    return Buffer.from(font.toArrayBuffer())
}

function main() {
    const suffix = (process.env.SUFFIX || "").trim()
    const suffixSafe = suffix ? suffix : ""
    if (suffixSafe && !/^[A-Za-z0-9_-]+$/.test(suffixSafe)) {
        throw new Error(`Invalid suffix: ${JSON.stringify(suffixSafe)} (expected [A-Za-z0-9_-]+)`)
    }

    const weightMin = toNumber("WEIGHT_MIN", process.env.WEIGHT_MIN || "200")
    const weightMax = toNumber("WEIGHT_MAX", process.env.WEIGHT_MAX || "700")
    const weightStep = toNumber("WEIGHT_STEP", process.env.WEIGHT_STEP || "25")
    const letterSpacing = toNumber("LETTER_SPACING", process.env.LETTER_SPACING || "0")
    const lineHeight = toNumber("LINE_HEIGHT", process.env.LINE_HEIGHT || "1")
    const outDir = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(getRepoRoot(), "fonts")

    const enabledFeatures = parseList(process.env.FEATURES)
    const enabledAlternates = parseList(process.env.ALTERNATES)

    const features = buildBooleanMap(KNOWN_FEATURES, enabledFeatures)
    const alternates = buildBooleanMap(KNOWN_ALTERNATES, enabledAlternates)

    const repoRoot = getRepoRoot()
    const fontlabDir = path.join(repoRoot, "src", "fonts", "fontlab")
    const versionTag = detectCommitMonoVersion(fontlabDir)

    const suffixWithHyphen = suffixSafe ? `-${suffixSafe}` : ""
    const fontName = `CommitMono${suffixWithHyphen}`

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    const plannedWeights = []
    for (let w = weightMin; w <= weightMax; w += weightStep) plannedWeights.push(w)

    const startedAt = Date.now()
    let written = 0

    for (const weight of plannedWeights) {
        for (const italic of [false, true]) {
            const italicSuffix = italic ? "Italic" : "Regular"
            const inputPath = path.join(fontlabDir, `CommitMono${versionTag}-${weight}${italicSuffix}.otf`)
            if (!fs.existsSync(inputPath)) {
                throw new Error(`Missing input font: ${inputPath}`)
            }

            const style = `${weight}${italicSuffix}`
            const outputFilename = `${fontName}-${weight}-${italicSuffix}.otf`
            const outputPath = path.join(outDir, outputFilename)

            const outputBuffer = makeCustomFont({
                inputPath,
                fontName,
                weight,
                italic,
                style,
                alternates,
                features,
                letterSpacing,
                lineHeight,
            })

            fs.writeFileSync(outputPath, outputBuffer)
            written += 1
            process.stdout.write(`Wrote ${outputFilename}\n`)
        }
    }

    const customSettings = {
        weight: null,
        italic: false,
        alternates,
        features,
        letterSpacing,
        lineHeight,
        fontName: suffixWithHyphen,
    }
    fs.writeFileSync(path.join(outDir, "custom-settings.json"), JSON.stringify(customSettings))

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    process.stdout.write(`Done: ${written} OTF files in ${outDir} (${seconds}s)\n`)
}

main()
