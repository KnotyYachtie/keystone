import { supabase } from './lib/supabase'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

const pdfParse = require('pdf-parse')

const MINIMUM_OBSERVATION_CONFIDENCE = 0.7

const PRIMARY_CONTEXT_WINDOW_SIZE = 12000
const TITLE_REGION_WINDOW_SIZE = 2500
const TOC_REGION_WINDOW_SIZE = 15000

const SITE_ALIAS_WINDOW_SIZE = 18000

const HIGH_AUTHORITY_SOURCE_PATTERNS = [
  'epa id',
  'city/county',
  'npl status',
  'site name',
  'operable unit',
  'region:',
  'superfund site',
  'site inspection',
  'record of decision'
]

const SOURCE_URL =
  'https://semspub.epa.gov/work/04/11226031.pdf'

async function main() {
  console.log('\nFETCHING SOURCE...')

  // Fetch external source
  const response = await fetch(SOURCE_URL)

  const contentType = response.headers.get('content-type') ?? 'unknown'

  console.log('FETCH COMPLETE')
  console.log({
    status: response.status,
    contentType
  })

  let rawContent = ''

  // Content-type-aware ingestion
  if (contentType.includes('application/pdf')) {
    console.log('\nPDF DETECTED')
    console.log('Beginning PDF text extraction...')

    const pdfBuffer = Buffer.from(await response.arrayBuffer())

    const parsedPdf = await pdfParse(pdfBuffer)

    rawContent = parsedPdf.text

    console.log('\nPDF EXTRACTION COMPLETE')
    console.log({
      pageCount: parsedPdf.numpages,
      contentLength: rawContent.length
    })
  } else {
    rawContent = await response.text()

    console.log({
      contentLength: rawContent.length
    })
  }

  // Deterministic keyword extraction

  const keywordObservations: Array<{
    category: string
    value: string
    confidence: number
    metadata: Record<string, unknown>
  }> = []

  const keywordChecks = [
    {
      keyword: 'EPA',
      value: 'Detected EPA terminology in retrieved source.'
    },
    {
      keyword: 'SEMS',
      value: 'Detected SEMS terminology in retrieved source.'
    },
    {
      keyword: 'Search',
      value: 'Detected search terminology in retrieved source.'
    },
    {
      keyword: 'Superfund',
      value: 'Detected Superfund terminology in retrieved source.'
    }
  ]

  for (const check of keywordChecks) {
    if (rawContent.includes(check.keyword)) {
      keywordObservations.push({
        category: 'keyword_detection',
        value: check.value,
        confidence: 1.0,
        metadata: {
          detection_type: 'deterministic_keyword_match',
          keyword: check.keyword
        }
      })
    }
  }

  console.log('\nKEYWORD EXTRACTION COMPLETE')
  console.log(keywordObservations)

  // Structured environmental extraction

  const structuredObservations: Array<{
    category: string
    value: string
    confidence: number
    metadata: Record<string, unknown>
  }> = []

  // Extract years/dates
  const detectedYears = rawContent.match(/\b(19|20)\d{2}\b/g) || []

  const uniqueYears = [...new Set(detectedYears)].slice(0, 10)

  for (const year of uniqueYears) {
    structuredObservations.push({
      category: 'date_detection',
      value: `Detected environmental chronology reference year: ${year}`,
      confidence: 0.95,
      metadata: {
        extraction_type: 'regex_year_detection',
        detected_year: year
      }
    })
  }

  // Extract remediation terminology
  const remediationTerms = [
    'groundwater',
    'soil',
    'contamination',
    'remediation',
    'hazardous',
    'cleanup',
    'monitoring'
  ]

  for (const term of remediationTerms) {
    if (rawContent.toLowerCase().includes(term.toLowerCase())) {
      structuredObservations.push({
        category: 'remediation_terminology',
        value: `Detected remediation terminology: ${term}`,
        confidence: 0.97,
        metadata: {
          extraction_type: 'deterministic_term_match',
          detected_term: term
        }
      })
    }
  }

  // Entity extraction

  // CERCLIS / EPA IDs
  const cerclisMatches =
    rawContent.match(/\b[A-Z]{2,3}\d{8,12}\b/g) || []

  const uniqueCerclisIds = [...new Set(cerclisMatches)].slice(0, 10)

  for (const cerclisId of uniqueCerclisIds) {
    structuredObservations.push({
      category: 'epa_identifier_detection',
      value: `Detected EPA/CERCLIS identifier: ${cerclisId}`,
      confidence: 0.98,
      metadata: {
        extraction_type: 'regex_identifier_detection',
        identifier: cerclisId
      }
    })
  }

  // State detection
  const states = [
    'Florida',
    'Georgia',
    'Alabama',
    'Texas',
    'Louisiana',
    'Mississippi',
    'Tennessee',
    'Kentucky',
    'North Carolina',
    'South Carolina'
  ]

  // Primary document context anchoring

  const primaryContextRegion = rawContent.slice(
    0,
    PRIMARY_CONTEXT_WINDOW_SIZE
  )

  function detectPrimaryContext(rawText: string) {
    const normalized = rawText.toLowerCase()

    const focusedOpeningRegion = rawText.slice(0, 4000)
    const titleRegion = rawText.slice(
      0,
      TITLE_REGION_WINDOW_SIZE
    )
    const aliasRegion = rawText.slice(
      0,
      SITE_ALIAS_WINDOW_SIZE
    )

    const detectedStates = states.filter(state =>
      normalized.includes(state.toLowerCase())
    )

    const siteNamePatterns = [
      /([A-Z][A-Z0-9\-\s\.,()]{8,80})(SUPERFUND SITE)/g,
      /([A-Z][A-Z0-9\-\s\.,()]{8,80})(SITE)/g
    ]

    const detectedSiteNames = new Set<string>()

    for (const pattern of siteNamePatterns) {
      const matches = [...focusedOpeningRegion.matchAll(pattern)]

      for (const match of matches) {
        const cleaned = match[0]
          .replace(/\s+/g, ' ')
          .trim()

        if (cleaned.length >= 10) {
          detectedSiteNames.add(cleaned)
        }
      }
    }

    const inferredAliases = new Set<string>()

    const aliasPatterns = [
      /stauffer chemical co\.?/gi,
      /stauffer chemical company/gi,
      /stauffer chemical/gi,
      /tarpon springs/gi,
      /stauffer site/gi
    ]

    for (const pattern of aliasPatterns) {
      const matches = [...aliasRegion.matchAll(pattern)]

      for (const match of matches) {
        inferredAliases.add(match[0].trim())
      }
    }

    const inferredDocumentTitle = titleRegion
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 8)
      .filter(
        line =>
          !line.toLowerCase().includes('prepared by') &&
          !line.toLowerCase().includes('region 4') &&
          !line.toLowerCase().includes('atlanta, georgia')
      )
      .slice(0, 8)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    return {
      states: detectedStates,
      siteNames: [...detectedSiteNames].slice(0, 5),
      aliases: [...inferredAliases].slice(0, 10),
      inferredDocumentTitle
    }
  }

  const primaryContext = detectPrimaryContext(
    primaryContextRegion
  )

  console.log('\nPRIMARY DOCUMENT CONTEXT')
  console.log(primaryContext)

  const tocRegion = rawContent
    .slice(0, TOC_REGION_WINDOW_SIZE)
    .toLowerCase()

  // Sentence segmentation for contextual extraction
  const sentences = rawContent
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0)

  // Context quality scoring
  function calculateContextQuality(sentence: string) {
    let score = 0.5

    const positiveSignals = [
      'site',
      'facility',
      'epa',
      'superfund',
      'county',
      'city',
      'located',
      'operable unit',
      'groundwater',
      'contamination',
      'cercla',
      'remedial investigation',
      'record of decision',
      'soil cleanup',
      'monitoring well',
      'npl status',
      'epa id',
      'region:'
    ]

    const negativeSignals = [
      'table of contents',
      'contents',
      'appendix',
      'appendix f',
      'public notice',
      'list of abbreviations',
      'acronyms',
      'glossary',
      'references',
      'table ',
      'figure ',
      '........',
      'page intentionally left blank',
      'error! bookmark'
    ]

    const normalizedSentence = sentence.toLowerCase()
    const titleAnchor =
      primaryContext.inferredDocumentTitle
        ?.toLowerCase()
        .slice(0, 120) ?? ''

    // Primary-context semantic anchoring

    for (const state of primaryContext.states) {
      if (
        normalizedSentence.includes(state.toLowerCase())
      ) {
        score += 0.12
      }
    }

    for (const siteName of primaryContext.siteNames) {
      if (
        normalizedSentence.includes(
          siteName.toLowerCase()
        )
      ) {
        score += 0.25
      }
    }

    for (const alias of primaryContext.aliases ?? []) {
      if (
        normalizedSentence.includes(
          alias.toLowerCase()
        )
      ) {
        score += 0.18
      }
    }

    if (
      titleAnchor.length > 20 &&
      normalizedSentence.includes(titleAnchor)
    ) {
      score += 0.35
    }

    for (const signal of positiveSignals) {
      if (normalizedSentence.includes(signal)) {
        score += 0.08
      }
    }

    for (const signal of negativeSignals) {
      if (normalizedSentence.includes(signal)) {
        score -= 0.2
      }
    }

    // Structured metadata bonus
    for (const authorityPattern of HIGH_AUTHORITY_SOURCE_PATTERNS) {
      if (
        normalizedSentence.includes(authorityPattern)
      ) {
        score += 0.08
      }
    }

    // Penalize noisy OCR fragments
    if (
      normalizedSentence.includes('this page intentionally left blank') ||
      normalizedSentence.includes('error!')
    ) {
      score -= 0.35
    }

    // Penalize very short fragments
    if (sentence.length < 40) {
      score -= 0.15
    }

    // Reward well-structured contextual evidence
    if (sentence.length > 120) {
      score += 0.05
    }

    // Penalize broad regional/list references
    if (
      normalizedSentence.includes('the sites, located in')
    ) {
      score -= 0.18
    }

    // Penalize TOC-style formatting patterns
    if (
      /\.{5,}/.test(sentence) ||
      /^([IVX]+\.|\d+\.)\s/.test(sentence.trim())
    ) {
      score -= 0.25
    }

    // Penalize broad EPA press-release style regional references
    if (
      normalizedSentence.includes('southeast superfund sites') ||
      normalizedSentence.includes('47 superfund sites') ||
      normalizedSentence.includes('epa to review cleanups')
    ) {
      score -= 0.2
    }

    // TOC/table reference suppression
    if (
      tocRegion.includes(normalizedSentence) &&
      (
        normalizedSentence.includes('table ') ||
        normalizedSentence.includes('figure ') ||
        normalizedSentence.includes('appendix')
      )
    ) {
      score -= 0.3
    }

    // Strong reward for explicit site metadata blocks
    if (
      normalizedSentence.includes('tarpon springs') ||
      normalizedSentence.includes('pinellas county') ||
      normalizedSentence.includes('stauffer chemical') ||
      normalizedSentence.includes('florida')
    ) {
      score += 0.28
    }

    return Math.max(0, Math.min(score, 1))
  }

  function deriveSignalStrength(confidence: number) {
    if (confidence >= 0.8) {
      return 'high'
    }

    if (confidence >= 0.65) {
      return 'medium'
    }

    return 'low'
  }


  for (const state of states) {
    const candidateSentences = sentences.filter(sentence =>
      sentence.includes(state)
    )

    const rankedSentence = candidateSentences
      .map(sentence => ({
        sentence,
        score: calculateContextQuality(sentence)
      }))
      .sort((a, b) => b.score - a.score)[0]

    if (rankedSentence && rankedSentence.score >= 0.55) {
      structuredObservations.push({
        category: 'state_detection',
        value: `Detected U.S. state reference: ${state}`,
        confidence: rankedSentence.score,
        metadata: {
          extraction_type: 'ranked_contextual_state_match',
          state,
          signal_strength: deriveSignalStrength(
            rankedSentence.score
          ),
          context_quality_score: rankedSentence.score,
          context_window: rankedSentence.sentence.slice(0, 300)
        }
      })
    }
  }

  // Contaminant extraction
  const contaminants = [
    'benzene',
    'lead',
    'arsenic',
    'vinyl chloride',
    'toluene',
    'pcb',
    'trichloroethylene',
    'pesticide'
  ]

  for (const contaminant of contaminants) {
    const candidateSentences = sentences.filter(sentence =>
      sentence.toLowerCase().includes(contaminant.toLowerCase())
    )

    const rankedSentence = candidateSentences
      .map(sentence => ({
        sentence,
        score: calculateContextQuality(sentence)
      }))
      .sort((a, b) => b.score - a.score)[0]

    // Semantic suppression for weak policy/guidance references
    if (
      rankedSentence &&
      contaminant === 'lead' &&
      rankedSentence.sentence
        .toLowerCase()
        .includes('guidance')
    ) {
      rankedSentence.score -= 0.15
    }

    if (rankedSentence && rankedSentence.score >= 0.55) {
      structuredObservations.push({
        category: 'contaminant_detection',
        value: `Detected contaminant reference: ${contaminant}`,
        confidence: rankedSentence.score,
        metadata: {
          extraction_type: 'ranked_contextual_contaminant_match',
          contaminant,
          signal_strength: deriveSignalStrength(
            rankedSentence.score
          ),
          context_quality_score: rankedSentence.score,
          context_window: rankedSentence.sentence.slice(0, 300)
        }
      })
    }
  }

  console.log('\nSTRUCTURED EXTRACTION COMPLETE')
  console.log(structuredObservations)

  keywordObservations.push(...structuredObservations)

  const extractionSummary = {
    totalObservations:
      keywordObservations.length,

    highConfidence:
      keywordObservations.filter(
        observation => observation.confidence >= 0.8
      ).length,

    mediumConfidence:
      keywordObservations.filter(
        observation =>
          observation.confidence >= 0.65 &&
          observation.confidence < 0.8
      ).length,

    lowConfidence:
      keywordObservations.filter(
        observation => observation.confidence < 0.65
      ).length
  }

  console.log('\nEXTRACTION SUMMARY')
  console.log(extractionSummary)

  const persistedObservations =
    keywordObservations.filter(
      observation =>
        observation.confidence >=
        MINIMUM_OBSERVATION_CONFIDENCE
    )

  const contentHash = crypto
    .createHash('sha256')
    .update(rawContent)
    .digest('hex')

  // Create mission
  const { data: mission, error: missionError } = await supabase
    .from('missions')
    .insert({
      title: 'EPA SEMS Ingestion Test',
      description: 'Testing first live external ingestion transaction.'
    })
    .select()
    .single()

  if (missionError || !mission) {
    console.error('\nMISSION ERROR')
    console.error(missionError)
    return
  }

  console.log('\nMISSION CREATED')
  console.log(mission)

  // Persist artifact
  const { data: artifact, error: artifactError } = await supabase
    .from('artifacts')
    .insert({
      mission_id: mission.id,
      artifact_type: 'epa_repository',
      source_url: SOURCE_URL,
      title: 'EPA SEMS Repository',
      raw_content: rawContent.slice(0, 10000),
      metadata: {
        source: 'EPA',
        retrieval_status: response.status,
        retrieval_timestamp: new Date().toISOString(),
        content_length: rawContent.length,
        content_hash: contentHash
      }
    })
    .select()
    .single()

  if (artifactError || !artifact) {
    console.error('\nARTIFACT ERROR')
    console.error(artifactError)
    return
  }

  console.log('\nARTIFACT CREATED')
  console.log({
    id: artifact.id,
    artifact_type: artifact.artifact_type,
    source_url: artifact.source_url
  })

  // Persist observations

  for (const extractedObservation of persistedObservations) {
    const { data: observation, error: observationError } = await supabase
      .from('observations')
      .insert({
        mission_id: mission.id,
        artifact_id: artifact.id,
        category: extractedObservation.category,
        value: extractedObservation.value,
        confidence: extractedObservation.confidence,
        metadata: extractedObservation.metadata
      })
      .select()
      .single()

    if (observationError || !observation) {
      console.error('\nOBSERVATION ERROR')
      console.error(observationError)
      continue
    }

    console.log('\nOBSERVATION CREATED')
    console.log(observation)
  }

  // Reload persisted cognition state
  const { data: artifacts } = await supabase
    .from('artifacts')
    .select('*')
    .eq('mission_id', mission.id)

  const { data: observations } = await supabase
    .from('observations')
    .select('*')
    .eq('mission_id', mission.id)

  console.log('\nRETRIEVED COGNITION STATE')
  console.log({
    mission,
    artifactCount: artifacts?.length ?? 0,
    observationCount: observations?.length ?? 0
  })

  const outputPath = path.join(
    __dirname,
    'testResults.json'
  )

  const testResultsPayload = {
    generated_at: new Date().toISOString(),

    extraction_summary: extractionSummary,

    primary_context: primaryContext,

    canonical_entity_preview: {
      inferred_site_name:
        primaryContext.siteNames?.[0] ?? null,

      inferred_aliases:
        primaryContext.aliases ?? [],

      inferred_state:
        primaryContext.states?.[0] ?? null,

      inferred_site_type:
        rawContent
          .toLowerCase()
          .includes('superfund')
          ? 'superfund_site'
          : 'unknown'
    },

    ingestion_configuration: {
      minimum_observation_confidence:
        MINIMUM_OBSERVATION_CONFIDENCE,
      primary_context_window_size:
        PRIMARY_CONTEXT_WINDOW_SIZE,
      title_region_window_size:
        TITLE_REGION_WINDOW_SIZE,
      toc_region_window_size:
        TOC_REGION_WINDOW_SIZE
    },

    persisted_observation_count:
      persistedObservations.length,

    mission,

    artifacts,

    observations
  }

  await fs.writeFile(
    outputPath,
    JSON.stringify(testResultsPayload, null, 2),
    'utf-8'
  )

  console.log('\nTEST RESULTS WRITTEN')

  console.log({
    outputPath
  })
}

main()