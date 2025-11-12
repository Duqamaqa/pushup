import { supabase } from './supabase.js';

export async function getFriends(currentUserId) {
  const { data, error } = await supabase
    .from('friendships')
    .select('friend_id')
    .eq('user_id', currentUserId);

  if (error) {
    console.error('Failed to fetch friends', error);
    throw error;
  }

  return Array.isArray(data) ? data.map((row) => row.friend_id) : [];
}
