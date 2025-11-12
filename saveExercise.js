import { supabase } from './supabase.js';

const userId = process.env.SUPABASE_USER_ID;

if (!userId) {
  throw new Error('Missing SUPABASE_USER_ID environment variable');
}

export async function saveExercise(name, reps) {
  const entry = {
    name,
    reps,
    created_at: new Date().toISOString(),
    user_id: userId,
  };

  const { data, error } = await supabase
    .from('exercise_logs')
    .insert(entry)
    .select('*')
    .single();

  if (error) {
    console.error('Failed to save exercise log', error);
    throw error;
  }

  return data;
}
