// Deploy Azure Web PubSub + Static Web App for the PTY relay.
// Usage:
//   az group create -n pty-relay-rg -l westeurope
//   az deployment group create -g pty-relay-rg --template-file deploy.bicep \
//     --parameters staticWebAppRepositoryUrl=<your-github-repo-url> \
//                  aadTenantId=<your-tenant-id> \
//                  aadClientId=<your-app-registration-client-id> \
//                  aadClientSecret=<your-app-registration-secret>

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Name prefix used for all resources')
param namePrefix string = 'pty-relay'

@description('GitHub repo URL for the Static Web App (e.g. https://github.com/you/repo)')
param staticWebAppRepositoryUrl string

@description('Branch to deploy from')
param staticWebAppBranch string = 'main'

@description('Your AAD tenant ID (for Static Web App auth)')
param aadTenantId string

@description('App registration client ID for Static Web App AAD auth')
param aadClientId string

@secure()
@description('App registration client secret for Static Web App AAD auth')
param aadClientSecret string

// ── Azure Web PubSub ──────────────────────────────────────────────────────────

resource webPubSub 'Microsoft.SignalRService/webPubSub@2023-02-01' = {
  name: '${namePrefix}-wps'
  location: location
  sku: {
    name: 'Free_F1'
    tier: 'Free'
    capacity: 1
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

resource webPubSubHub 'Microsoft.SignalRService/webPubSub/hubs@2023-02-01' = {
  parent: webPubSub
  name: 'terminal'
  properties: {
    // Allow clients to send to groups directly via json.webpubsub.azure.v1 subprotocol
    anonymousConnectPolicy: 'deny'
  }
}

// ── Azure Static Web App ──────────────────────────────────────────────────────

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: '${namePrefix}-swa'
  location: location  // SWA supported regions: centralus, eastus2, eastasia, westeurope, westus2
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    repositoryUrl:    staticWebAppRepositoryUrl
    branch:           staticWebAppBranch
    buildProperties: {
      appLocation:    'web-app'
      apiLocation:    'web-app/api'
      outputLocation: 'dist'
    }
  }
}

// App settings — injected as environment variables into the Azure Function
resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    WEB_PUBSUB_CONNECTION_STRING: webPubSub.listKeys().primaryConnectionString
    AAD_CLIENT_ID:                aadClientId
    AAD_CLIENT_SECRET:            aadClientSecret
    TENANT_ID:                    aadTenantId
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────

output webPubSubConnectionString string = webPubSub.listKeys().primaryConnectionString
output staticWebAppUrl           string = 'https://${staticWebApp.properties.defaultHostname}'
output webPubSubEndpoint         string = webPubSub.properties.externalIP ?? webPubSub.name
