import { supabase } from './lib/supabase'

const missionId = '96458042-2283-4f77-bcbf-5bb40e09bdb4'

async function main() {
  // Retrieve mission
  const { data: mission, error: missionError } = await supabase
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .single()

  if (missionError) {
    console.error('MISSION RETRIEVAL ERROR')
    console.error(missionError)
    return
  }

  // Retrieve artifacts
  const { data: artifacts, error: artifactError } = await supabase
    .from('artifacts')
    .select('*')
    .eq('mission_id', missionId)

  if (artifactError) {
    console.error('ARTIFACT RETRIEVAL ERROR')
    console.error(artifactError)
    return
  }

  // Retrieve observations
  const { data: observations, error: observationError } = await supabase
    .from('observations')
    .select('*')
    .eq('mission_id', missionId)

  if (observationError) {
    console.error('OBSERVATION RETRIEVAL ERROR')
    console.error(observationError)
    return
  }

  console.log('\nMISSION')
  console.log(mission)

  console.log('\nARTIFACTS')
  console.log(artifacts)

  console.log('\nOBSERVATIONS')
  console.log(observations)
}

main()