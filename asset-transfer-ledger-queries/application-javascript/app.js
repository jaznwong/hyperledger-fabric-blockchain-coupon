/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
const { buildCAClient, registerAndEnrollUser, enrollAdmin } = require('../../test-application/javascript/CAUtil.js');
const { buildCCPOrg1, buildWallet } = require('../../test-application/javascript/AppUtil.js');

const channelName = 'mychannel';
const chaincodeName = 'ledger';
const mspOrg1 = 'Org1MSP';

const walletPath = path.join(__dirname, 'wallet');
const userId = 'appUser';

function prettyJSONString(inputString) {
	return JSON.stringify(JSON.parse(inputString), null, 2);
}

// pre-requisites:
// - fabric-sample two organization test-network setup with two peers, ordering service,
//   and 2 certificate authorities, with the state database using couchdb
//         ===> from directory /fabric-samples/test-network
//         ./network.sh up createChannel -ca -s couchdb
// - Use any of the asset-transfer-ledger-queries chaincodes deployed on the channel "mychannel"
//   with the chaincode name of "ledger". The following deploy command will package,
//   install, approve, and commit the javascript chaincode, all the actions it takes
//   to deploy a chaincode to a channel.
//         ===> from directory /fabric-samples/test-network
//         ./network.sh deployCC -ccn ledger -ccl javascript
// - Be sure that node.js is installed
//         ===> from directory /fabric-samples/asset-transfer-ledger-queries/application-javascript
//         node -v
// - npm installed code dependencies
//         ===> from directory /fabric-samples/asset-transfer-ledger-queries/application-javascript
//         npm install
// - to run this test application
//         ===> from directory /fabric-samples/asset-transfer-ledger-queries/application-javascript
//         node app.js

// NOTE: If you see  kind an error like these:
/*
    2020-08-07T20:23:17.590Z - error: [DiscoveryService]: send[mychannel] - Channel:mychannel received discovery error:access denied
    ******** FAILED to run the application: Error: DiscoveryService: mychannel error: access denied

   OR

   Failed to register user : Error: fabric-ca request register failed with errors [[ { code: 20, message: 'Authentication failure' } ]]
   ******** FAILED to run the application: Error: Identity not found in wallet: appUser
*/
// Delete the /fabric-samples/asset-transfer-ledger-queries/application-javascript/wallet directory
// and retry this application.
//
// The certificate authority must have been restarted and the saved certificates for the
// admin and application user are not valid. Deleting the wallet store will force these to be reset
// with the new certificate authority.
//

/**
 *  A test application to show ledger queries operations with any of the asset-transfer-ledger-queries chaincodes
 *   -- How to submit a transaction
 *   -- How to query and check the results
 *
 * To see the SDK workings, try setting the logging to show on the console before running
 *        export HFC_LOGGING='{"debug":"console"}'
 */
async function main() {
	let skipInit = false;
	if (process.argv.length > 2) {
		if (process.argv[2] === 'skipInit') {
			skipInit = true;
		}
	}

	try {
		// build an in memory object with the network configuration (also known as a connection profile)
		const ccp = buildCCPOrg1();

		// build an instance of the fabric ca services client based on
		// the information in the network configuration
		const caClient = buildCAClient(FabricCAServices, ccp, 'ca.org1.example.com');

		// setup the wallet to hold the credentials of the application user
		const wallet = await buildWallet(Wallets, walletPath);

		// in a real application this would be done on an administrative flow, and only once
		await enrollAdmin(caClient, wallet, mspOrg1);

		// in a real application this would be done only when a new user was required to be added
		// and would be part of an administrative flow
		await registerAndEnrollUser(caClient, wallet, mspOrg1, userId, 'org1.department1');

		// Create a new gateway instance for interacting with the fabric network.
		// In a real application this would be done as the backend server session is setup for
		// a user that has been verified.
		const gateway = new Gateway();

		try {
			// setup the gateway instance
			// The user will now be able to create connections to the fabric network and be able to
			// submit transactions and query. All transactions submitted by this gateway will be
			// signed by this user using the credentials stored in the wallet.
			await gateway.connect(ccp, {
				wallet,
				identity: userId,
				discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
			});

			// Build a network instance based on the channel where the smart contract is deployed
			const network = await gateway.getNetwork(channelName);

			// Get the contract from the network.
			const contract = network.getContract(chaincodeName);

			// Initialize a set of asset data on the channel using the chaincode 'InitLedger' function.
			// This type of transaction would only be run once by an application the first time it was started after it
			// deployed the first time. Any updates to the chaincode deployed later would likely not need to run
			// an "init" type function.
			if (!skipInit) {
				try {
					console.log('\n--> Submit Transaction: InitLedger, function creates the initial set of assets on the ledger');
					await contract.submitTransaction('InitLedger');
					console.log('*** Result: committed');
				} catch (initError) {
					// this is error is OK if we are rerunning this app without restarting
					console.log(`******** initLedger failed :: ${initError}`)
				}
			} else {
				console.log('*** not executing "InitLedger');
			}

			let result;

			// Let's try a query operation (function).
			// This will be sent to just one peer and the results will be shown.
			// console.log('\n--> Evaluate Transaction: GetAssetsByRange, function returns assets in a specific range from asset1 to before asset6');
			// result = await contract.evaluateTransaction('GetAssetsByRange', 'coupon1', 'coupon6');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			console.log('\n--> Evaluate Transaction: GetAssetsByRange, function use an open start and open end range to return assest1 to asset6');
			result = await contract.evaluateTransaction('GetAssetsByRange', '', '');
			console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// console.log('\n--> Evaluate Transaction: GetAssetsByRange, function use an fixed start (asset3) and open end range to return assest3 to asset6');
			// result = await contract.evaluateTransaction('GetAssetsByRange', 'coupon3', '');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// console.log('\n--> Evaluate Transaction: GetAssetsByRange, function use an open start and fixed end (asset3) range to return assest1 to asset2');
			// result = await contract.evaluateTransaction('GetAssetsByRange', '', 'coupon3');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// Now let's try to submit a transaction.
			// This will be sent to both peers and if both peers endorse the transaction, the endorsed proposal will be sent
			// to the orderer to be committed by each of the peer's to the channel ledger.
			// console.log('\n--> Submit Transaction: CreateAsset, creates new asset with ID(coupon7), value(5), owner(Tom Brady), and expiration(2020-12-13) arguments');
			// await contract.submitTransaction('CreateAsset', 'Tom Brady', 'coupon7', '5', '2021-12-13');
			// console.log('*** Result: committed');

			// console.log('\n--> Evaluate Transaction: ReadAsset, function returns information about an asset with ID(asset7)');
			// result = await contract.evaluateTransaction('ReadAsset', 'coupon7');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// console.log('\n--> Evaluate Transaction: AssetExists, function returns "true" if an asset with ID(asset7) exist');
			// result = await contract.evaluateTransaction('AssetExists', 'coupon7');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// // Now let's try to submit a transaction that deletes an asset
			// // This will be sent to both peers and if both peers endorse the transaction, the endorsed proposal will be sent
			// // to the orderer to be committed by each of the peer's to the channel ledger.
			// console.log('\n--> Submit Transaction: DeleteAsset with ID(coupon7)');
			// await contract.submitTransaction('DeleteAsset', 'coupon7');
			// console.log('*** Result: committed');

			// console.log('\n--> Evaluate Transaction: AssetExists, function returns "false" if an asset with ID(asset7) does not exist');
			// result = await contract.evaluateTransaction('AssetExists', 'coupon7');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`)

			// console.log('\n--> Submit Transaction: TransferAsset, transfer asset(coupon2) to new owner(Tom)');
			// await contract.submitTransaction('TransferAsset', 'coupon2', 'Tom Brady');
			// console.log('*** Result: committed');

			console.log('\n--> Submit Transaction: RedeemCoupon, set asset(coupon2) to redeemed');
			await contract.submitTransaction('SetCouponToRedeemed', 'coupon2');
			console.log('*** Result: Redeemed');

			//to do: check if coupon is redeemed
			console.log('\n--> Evaluate Transaction: CouponRedeemed, function returns "false" if an asset with ID(coupon2) is not redeemed');
			result = await contract.evaluateTransaction('CouponRedeemed', 'coupon2');
			console.log(`*** Result: ${prettyJSONString(result.toString())}`)

			//to do: check if coupon is redeemed
			console.log('\n--> Evaluate Transaction: CouponRedeemed, function returns "false" if an asset with ID(coupon7) is not redeemed');
			result = await contract.evaluateTransaction('CouponRedeemed', 'coupon7');
			console.log(`*** Result: ${prettyJSONString(result.toString())}`)

			// console.log('\n--> Evaluate Transaction: ReadAsset, function returns information about an asset with ID(asset2)');
			// result = await contract.evaluateTransaction('ReadAsset', 'coupon2');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// Rich Query with Pagination (Only supported if CouchDB is used as state database)
			// console.log('\n--> Evaluate Transaction: QueryAssetsWithPagination, function returns "Tom Brady" assets');
			// result = await contract.evaluateTransaction('QueryAssetsWithPagination', 'Tom Brady', '3', '');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// console.log('\n--> Submit Transaction: TransferAssetByColor, transfer all yellow assets to new owner(Michel)');
			// await contract.submitTransaction('TransferAssetByColor', 'yellow', 'Michel');
			// console.log('*** Result: committed');

			// Rich Query (Only supported if CouchDB is used as state database):
			console.log('\n--> Evaluate Transaction: QueryAssetsByOwner, find all assets with owner(Tom Brady)');
			result = await contract.evaluateTransaction('QueryAssetsByOwner', 'Tom Brady');
			console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			console.log('\n--> Evaluate Transaction: GetAssetHistory, get the history of an asset(asset7)');
			result = await contract.evaluateTransaction('GetAssetHistory', 'coupon2');
			console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// Rich Query (Only supported if CouchDB is used as state database):
			// console.log('\n--> Evaluate Transaction: QueryAssets, assets of expiration 2021-01-01');
			// result = await contract.evaluateTransaction('QueryAssets', '{"selector":{"expiration":"2021-01-01"}}');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// // Rich Query with index design doc and index name specified (Only supported if CouchDB is used as state database):
			// console.log('\n--> Evaluate Transaction: QueryAssets, Jin Soo\'s assets');
			// result = await contract.evaluateTransaction('QueryAssets', '{"selector":{"docType":"asset","owner":"Jin Soo"}, "use_index":["_design/indexOwnerDoc", "indexOwner"]}');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// // Rich Query with Pagination (Only supported if CouchDB is used as state database)
			// console.log('\n--> Evaluate Transaction: GetAssetsByRangeWithPagination - get page 1 of assets from asset3 to asset6 (asset3, asset4)');
			// result = await contract.evaluateTransaction('GetAssetsByRangeWithPagination', 'asset3', 'asset6', '2', '');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			// // Rich Query with Pagination (Only supported if CouchDB is used as state database)
			// console.log('\n--> Evaluate Transaction: GetAssetsByRangeWithPagination - get page 2 of assets from asset3 to asset6 (asset4, asset5)');
			// result = await contract.evaluateTransaction('GetAssetsByRangeWithPagination', 'asset3', 'asset6', '2', 'asset4');
			// console.log(`*** Result: ${prettyJSONString(result.toString())}`);

			console.log('*** all tests completed');
		} finally {
			// Disconnect from the gateway when the application is closing
			// This will close all connections to the network
			gateway.disconnect();
		}
	} catch (error) {
		console.error(`******** FAILED to run the application: ${error}`);
	}

	console.log('*** application ending');

}

main();
