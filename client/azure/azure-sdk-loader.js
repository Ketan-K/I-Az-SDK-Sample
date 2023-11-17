const { sdk } = require('./azure-sdk')    

function initializeAzureSDK(window) {
    console.info('Azure : initializeAzureSDK', window)
    let mmrWindowManager = sdk();
    // mmrWindowManager.add(window)
    try{
        return Promise.resolve(mmrWindowManager.add(window))
    }catch (err){
    console.info('Error : initializeAzureSDK', err)

        return Promise.resolve();
    }
}

module.exports = { initializeAzureSDK };
