import { supabase } from './lib/supabase'

async function main() {
  // Create mission
  const { data: mission, error: missionError } = await supabase
    .from('missions')
    .insert({
      title: 'Darwin Runtime Persistence Test',
      description: 'Testing full cognition persistence loop.'
    })
    .select()
    .single()

  if (missionError || !mission) {
    console.error('MISSION ERROR')
    console.error(missionError)
    return
  }

  console.log('MISSION CREATED')
  console.log(mission)

  // Create artifact
  const { data: artifact, error: artifactError } = await supabase
    .from('artifacts')
    .insert({
      mission_id: mission.id,
      artifact_type: 'epa_repository',
      source_url: 'https://semspub.epa.gov',
      title: 'EPA SEMS Repository',
      raw_content: 'Initial repository discovery.',
      metadata: {
        source: 'EPA',
        confidence: 0.95
      }
    })
    .select()
    .single()

  if (artifactError || !artifact) {
    console.error('ARTIFACT ERROR')
    console.error(artifactError)
    return
  }

  console.log('ARTIFACT CREATED')
  console.log(artifact)

  // Create observation
  const { data: observation, error: observationError } = await supabase
    .from('observations')
    .insert({
      mission_id: mission.id,
      artifact_id: artifact.id,
      category: 'site_identification',
      value: 'Stauffer Chemical site identified.',
      confidence: 0.97,
      metadata: {
        observation_type: 'repository_match'
      }
    })
    .select()
    .single()

  if (observationError || !observation) {
    console.error('OBSERVATION ERROR')
    console.error(observationError)
    return
  }

  console.log('OBSERVATION CREATED')
  console.log(observation)
}

main()