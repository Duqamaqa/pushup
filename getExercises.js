import { supabase } from './supabase.js';

export async function getExercises(userId) {
  const { data, error } = await supabase
    .from('exercise_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch exercises', error);
    throw error;
  }

  return data;
}
