require('isomorphic-fetch')

const Koa = require('koa')
const Router = require('@koa/router')
const bodyparser = require('koa-bodyparser')
const cors = require('@koa/cors')
const koaStatic = require('koa-static')
const session = require('koa-session')
const mount = require('koa-mount')

const {
  default: shopifyAuth,
  verifyRequest,
} = require('@shopify/koa-shopify-auth')
const { default: Shopify, ApiVersion } = require('@shopify/shopify-api')

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_SHOP,
  SHOPIFY_HOST,
  SHOPIFY_SCOPES,
} = process.env

Shopify.Context.initialize({
  API_KEY: SHOPIFY_API_KEY,
  API_SECRET_KEY: SHOPIFY_API_SECRET,
  SCOPES: [
    'read_products',
    'write_products',
    'read_script_tags',
    'write_script_tags',
  ],
  HOST_NAME: SHOPIFY_HOST.replace(/^https:\/\//, ''),
  API_VERSION: ApiVersion.October20,
  IS_EMBEDDED_APP: true,
  SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(),
})

// Storing the currently active shops in memory will force them to re-login when your server restarts. You should
// persist this object in your app.
const ACTIVE_SHOPIFY_SHOPS = {}

const app = new Koa()
const router = new Router()

app.keys = [Shopify.Context.API_SECRET_KEY]
app
  .use(session(app))
  .use(bodyparser())
  .use(cors())
  .use(
    shopifyAuth({
      async afterAuth(ctx) {
        const { shop, accessToken } = ctx.state.shopify
        ACTIVE_SHOPIFY_SHOPS[shop] = true

        // Your app should handle the APP_UNINSTALLED webhook to make sure merchants go through OAuth if they reinstall it
        const response = await Shopify.Webhooks.Registry.register({
          shop,
          accessToken,
          path: '/webhooks',
          topic: 'APP_UNINSTALLED',
          webhookHandler: async (topic, shop, body) =>
            delete ACTIVE_SHOPIFY_SHOPS[shop],
        })

        if (!response.success) {
          console.log(
            `Failed to register APP_UNINSTALLED webhook: ${response.result}`,
          )
        }

        // Redirect to app with shop parameter upon auth
        ctx.redirect(`/?shop=${shop}`)
      },
    }),
  )
  .use(verifyRequest())

// Routes
router.get('/', async (ctx) => {
  const shop = ctx.query.shop

  // If this shop hasn't been seen yet, go through OAuth to create a session
  if (ACTIVE_SHOPIFY_SHOPS[shop] === undefined) {
    ctx.redirect(`/auth?shop=${shop}`)
  } else {
    const session = await Shopify.Utils.loadCurrentSession(ctx.req, ctx.res)
    const gqlclient = new Shopify.Clients.Graphql(
      session.shop,
      session.accessToken,
    )

    const restclient = new Shopify.Clients.Rest(
      session.shop,
      session.accessToken,
    )

    const { body } = await gqlclient.query({
      data: `
        {
          products(first: 1, reverse: true) {
            edges {
              node {
                id
                title
              }
            }
          }
          currentBulkOperation {
            status
          }
        }
      `,
    })

    const {
      body: { count },
    } = await restclient.get({
      path: '/products/count',
    })

    const {
      extensions: {
        cost: {
          throttleStatus: { maximumAvailable, currentlyAvailable },
        },
      },
      data: { products, currentBulkOperation },
    } = body

    ctx.body = `
    <!html>
    <body>
    <div>
      <p>
        <strong>Total Product Count: </strong>
        ${count}
      </p>

      <p>
        <strong>Latest Product: </strong>
        ${products.edges[0].node.title}

      </p>

      <p>
        <strong>Total Calls Remaining: </strong>
        ${currentlyAvailable}/${maximumAvailable}
      </p>
      <p>
        <strong>Bulk Operation status: </strong>
        ${currentBulkOperation?.status || 'NO BULK OPERATION FOUND'}

      </p>
    </div>
    `
  }
})

router.post('/webhooks', async (ctx) => {
  try {
    await Shopify.Webhooks.Registry.process(ctx.req, ctx.res)
    console.log(`Webhook processed, returned status code 200`)
  } catch (error) {
    console.log(`Failed to process webhook: ${error}`)
  }
})

app
  .use(koaStatic('public/index.html'))
  .use(router.routes())
  .use(router.allowedMethods())
module.exports = app
