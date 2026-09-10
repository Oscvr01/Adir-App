const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mspejiongrdsgbqomewj.supabase.co';
const supabaseKey = 'sb_publishable_-_DqtXu-GQ97LecbJgLgqw_ADU_ZMzG';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('propuestas').select('*').limit(1);
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Keys of a record in propuestas table:", data[0] ? Object.keys(data[0]) : "No records found");
    console.log("Sample record:", data[0]);
  }
}

run();
