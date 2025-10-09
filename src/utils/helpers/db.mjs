import { Pool } from 'pg'

const pool = new Pool({
  connectionString: "postgresql://postgres:musictutor@localhost:8080/90Database",
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1)
})

export default pool