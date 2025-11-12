import { supabase } from './supabase.js';
import { getFriends } from './getFriends.js';

export async function getFriendsExercises(currentUserId) {
  const friendIds = await getFriends(currentUserId);
  if (!Array.isArray(friendIds) || friendIds.length === 0) {
    return [];
  }

  const friendsExercises = await Promise.all(friendIds.map(async (friendId) => {
    const { data, error } = await supabase
      .from('exercise_logs')
      .select('name, reps')
      .eq('user_id', friendId);

    if (error) {
      console.error(`Failed to fetch exercises for friend ${friendId}`, error);
      throw error;
    }

    return {
      friend_id: friendId,
      exercises: Array.isArray(data) ? data.map(({ name, reps }) => ({ name, reps })) : [],
    };
  }));

  return friendsExercises;
}
