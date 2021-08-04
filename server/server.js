const http = require('http')
const app = require('./app')

const { PORT } = process.env

const server = http.createServer(app.callback())
server.listen(PORT || 3000, () => {
  console.log('App listening at :3000')
})

process
  .on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p)
  })
  .on('uncaughtException', (err) => {
    console.error(err, 'Uncaught Exception thrown')
  })
