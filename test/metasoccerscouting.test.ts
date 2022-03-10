import { MockProvider } from "ethereum-waffle";
import { BigNumber, Wallet } from "ethers";
import { expect } from "chai";
import { ethers, waffle, artifacts } from "hardhat";
import {
  TestERC721,
  TestToken,
  MetaSoccerScouting,
  TestERC20,
  MetaSoccerPlayers,
} from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { formatUnits, parseUnits } from "ethers/lib/utils";

const scoutingPeriod = 1000;

describe("Scout Scouting", function () {
  async function fixtures(wallets: Wallet[], provider: MockProvider) {
    const [deployer, backend, nonDeployer, nonDeployer2] =
      await ethers.getSigners();
    const testERC721 = artifacts.readArtifactSync("TestERC721");
    const testToken = artifacts.readArtifactSync("TestToken");

    const scouts = (await waffle.deployContract(deployer, testERC721, [
      "NFT To stake",
      "NTS",
    ])) as TestERC721;

    const anotherNft = (await waffle.deployContract(deployer, testERC721, [
      "Some other NFT",
      "SON",
    ])) as TestERC721;

    const token1 = (await waffle.deployContract(deployer, testToken, [
      "Token 1",
      "T1",
    ])) as TestToken;

    const token2 = (await waffle.deployContract(deployer, testToken, [
      "Token 2",
      "T2",
    ])) as TestToken;

    const entropyManagerContract = await waffle.deployMockContract(
      deployer,
      artifacts.readArtifactSync("EntropyManager").abi
    );

    await entropyManagerContract.mock.requestEntropy.returns();

    const idGenerator = await waffle.deployContract(
      deployer,
      artifacts.readArtifactSync("PlayersIdGenerator"),
      []
    );
    const players = (await waffle.deployContract(
      deployer,
      artifacts.readArtifactSync("MetaSoccerPlayers"),
      ["Awesome players", "MetaSoccerPlayer", idGenerator.address]
    )) as MetaSoccerPlayers;
    const metasoccerScouting = (await waffle.deployContract(
      deployer,
      artifacts.readArtifactSync("MetaSoccerScouting"),
      [
        scouts.address,
        players.address,
        entropyManagerContract.address,
        "scoutScouting",
        "SCT",
      ]
    )) as MetaSoccerScouting;

    const scoutingRole = await metasoccerScouting.SIGN_ATTRIBUTES_ROLE();
    await metasoccerScouting
      .connect(deployer)
      .grantRole(scoutingRole, backend.address);

    const minterRole = await players.MINTER_ROLE();
    await players
      .connect(deployer)
      .grantRole(minterRole, metasoccerScouting.address);

    const setEntropyRole = await metasoccerScouting.SET_ENTROPY_ROLE();
    await metasoccerScouting
      .connect(deployer)
      .grantRole(setEntropyRole, deployer.address);

    const setEntropyRolePlayer = await players.SET_ENTROPY_ROLE();
    await players
      .connect(deployer)
      .grantRole(setEntropyRolePlayer, metasoccerScouting.address);

    return {
      scouts: scouts,
      anotherNft,
      token1,
      token2,
      deployer,
      nonDeployer,
      nonDeployer2,
      backend,
      metasoccerScouting,
      players,
      entropyManagerContract,
    };
  }

  function getCurrentTimestampInSeconds(): number {
    return Math.round(Date.now() / 1000);
  }

  async function advanceToRewardTime(
    currentSecond: number,
    rewardsPeriod: number
  ): Promise<number> {
    const newSecond = currentSecond + rewardsPeriod;
    await ethers.provider.send("evm_mine", [newSecond]);
    return newSecond;
  }

  async function mintAndScout(
    scouts: TestERC721,
    scoutScouting: MetaSoccerScouting,
    owner: SignerWithAddress,
    tokenId: number,
    level: number,
    backend: SignerWithAddress
  ) {
    const role = "Goalkeeper";
    const timestamp = getCurrentTimestampInSeconds() + 1000000;
    await scouts.mint(owner.address, tokenId);
    await scouts.connect(owner).setApprovalForAll(scoutScouting.address, true);
    const signature = await getScoutingRequestSignature(
      scoutScouting,
      backend,
      tokenId,
      level,
      role,
      timestamp
    );
    const r = scoutScouting
      .connect(owner)
      .sendToScouting(
        tokenId,
        level,
        role,
        scoutingPeriod,
        timestamp,
        signature
      );

    return r;
  }

  async function getScoutingRequestSignature(
    scoutScouting: MetaSoccerScouting,
    backend: SignerWithAddress,
    tokenId: number,
    level: number,
    role: string,
    expirationTimestamp: number
  ) {
    const domain = {
      name: "MetaSoccer",
      version: "1",
      chainId: 31337,
      verifyingContract: scoutScouting.address.toLowerCase(),
    };

    // The data to sign
    const message = {
      scoutId: tokenId,
      level,
      role,
      scoutingPeriod,
      expirationTimestamp,
    };

    const ScoutingRequest = [
      { name: "scoutId", type: "uint256" },
      { name: "level", type: "uint8" },
      { name: "role", type: "string" },
      { name: "scoutingPeriod", type: "uint256" },
      { name: "expirationTimestamp", type: "uint256" },
    ];

    const types = {
      ScoutingRequest,
    };

    const signature = await backend._signTypedData(domain, types, message);
    return signature;
  }

  async function setPrices(
    token1: TestToken,
    token2: TestToken,
    level: number,
    token1Price: number,
    token2Price: number,
    metasoccerScouting: MetaSoccerScouting,
    deployer: SignerWithAddress
  ) {
    await metasoccerScouting
      .connect(deployer)
      .setPaymentTokens([token1.address, token2.address]);

    await metasoccerScouting.connect(deployer).setBeneficiary(deployer.address);

    await metasoccerScouting.setPrice(
      token1.address,
      level,
      ethers.utils.parseUnits(token1Price.toString(), 18)
    );

    await metasoccerScouting.setPrice(
      token2.address,
      level,
      ethers.utils.parseUnits(token2Price.toString(), 18)
    );
  }

  async function mintTestTokensAndGiveAllowance(
    user: SignerWithAddress,
    tokens: TestToken[],
    spender: string,
    amount: number
  ) {
    const promises: Promise<any>[] = [];
    tokens.forEach((token: TestToken) => {
      promises.push(
        token
          .connect(user)
          .mint(user.address, ethers.utils.parseUnits(amount.toString(), 18))
      );
      promises.push(
        token
          .connect(user)
          .approve(
            spender,
            ethers.utils.parseUnits("999999999999999999999999999999", 18)
          )
      );
    });

    return await Promise.all(promises);
  }

  describe("Should not be deployed with address 0 for scouts", async () => {
    it("Deploy should fail", async () => {
      const { players, entropyManagerContract, deployer } =
        await waffle.loadFixture(fixtures);
      const tx = waffle.deployContract(
        deployer,
        artifacts.readArtifactSync("MetaSoccerScouting"),
        [
          "0x0000000000000000000000000000000000000000",
          players.address,
          entropyManagerContract.address,
          "scoutScouting",
          "SCT",
        ]
      );

      await expect(tx).to.be.revertedWith("Wrong Scouts address");
    });
  });
  describe("Send scout to Scouting", () => {
    it("User should not be allowed to send scout to scouting contract", async function () {
      const { scouts, nonDeployer, metasoccerScouting } =
        await waffle.loadFixture(fixtures);

      const q = scouts.mint(nonDeployer.address, 1);
      await expect(q).to.not.be.reverted;

      const r = scouts
        .connect(nonDeployer)
        ["safeTransferFrom(address,address,uint256)"](
          nonDeployer.address,
          metasoccerScouting.address,
          1
        );
      await expect(r).to.be.revertedWith("Unable to receive NFT");
    });

    it("Only scout owner should be able to start scouting", async function () {
      const { backend, scouts, nonDeployer, nonDeployer2, metasoccerScouting } =
        await waffle.loadFixture(fixtures);

      const tokenId = 1;
      const level = 4;
      const role = "Goalkeeper";
      const timestamp = getCurrentTimestampInSeconds() + 1000000;
      await scouts.mint(nonDeployer.address, tokenId);
      await scouts
        .connect(nonDeployer)
        .setApprovalForAll(metasoccerScouting.address, true);
      const signature = await getScoutingRequestSignature(
        metasoccerScouting,
        backend,
        tokenId,
        level,
        role,
        timestamp
      );
      const r = metasoccerScouting
        .connect(nonDeployer2)
        .sendToScouting(
          tokenId,
          level,
          role,
          scoutingPeriod,
          timestamp,
          signature
        );

      await expect(r).to.be.revertedWith("Not Scout Owner");
    });

    it("Invalid signature should revert when starting scouting", async function () {
      const { backend, scouts, nonDeployer, metasoccerScouting } =
        await waffle.loadFixture(fixtures);

      const tokenId = 1;
      const level = 4;
      const role = "Goalkeeper";
      const timestamp = getCurrentTimestampInSeconds() + 1000000;
      await scouts.mint(nonDeployer.address, tokenId);
      await scouts
        .connect(nonDeployer)
        .setApprovalForAll(metasoccerScouting.address, true);
      const signature = await getScoutingRequestSignature(
        metasoccerScouting,
        backend,
        tokenId,
        level,
        role,
        timestamp
      );
      const r = metasoccerScouting
        .connect(nonDeployer)
        .sendToScouting(
          tokenId,
          level + 1,
          role,
          scoutingPeriod,
          timestamp,
          signature
        );

      await expect(r).to.be.revertedWith("Invalid signer");
    });

    it("Expired signature should revert when starting scouting", async function () {
      const { backend, scouts, nonDeployer, metasoccerScouting } =
        await waffle.loadFixture(fixtures);

      const tokenId = 1;
      const level = 4;
      const role = "Goalkeeper";
      const timestamp = getCurrentTimestampInSeconds() - 1000000;
      await scouts.mint(nonDeployer.address, tokenId);
      await scouts
        .connect(nonDeployer)
        .setApprovalForAll(metasoccerScouting.address, true);
      const signature = await getScoutingRequestSignature(
        metasoccerScouting,
        backend,
        tokenId,
        level,
        role,
        timestamp
      );
      const r = metasoccerScouting
        .connect(nonDeployer)
        .sendToScouting(
          tokenId,
          level,
          role,
          scoutingPeriod,
          timestamp,
          signature
        );

      await expect(r).to.be.revertedWith("Signature expired");
    });

    it("Owner with a valid backend signature can start scouting", async function () {
      const {
        scouts,
        deployer,
        backend,
        nonDeployer,
        metasoccerScouting,
        token1,
      } = await waffle.loadFixture(fixtures);

      await metasoccerScouting
        .connect(deployer)
        .setPaymentTokens([token1.address]);

      const r = mintAndScout(
        scouts,
        metasoccerScouting,
        nonDeployer,
        1,
        4,
        backend
      );

      await expect(r).to.emit(metasoccerScouting, "ScoutingStarted");
      const isScoutingForOwner = await metasoccerScouting.isScoutingForAddress(
        nonDeployer.address,
        1
      );

      expect(isScoutingForOwner).to.equal(true);

      const scoutingScoutIds = await metasoccerScouting.getOwnedTokenIds(
        nonDeployer.address
      );

      expect(scoutingScoutIds).to.deep.equal([BigNumber.from(1)]);
    });

    it("Payment is done when scouting is started", async () => {
      const token1Price = 1000;
      const token2Price = 4000;
      const amountToMint = 10000;

      const {
        scouts,
        nonDeployer,
        deployer,
        backend,
        metasoccerScouting,
        token1,
        token2,
      } = await waffle.loadFixture(fixtures);

      // Add payment tokens to scouting contract
      await setPrices(
        token1,
        token2,
        4,
        token1Price,
        token2Price,
        metasoccerScouting,
        deployer
      );
      // Give enough tokens to user

      await mintTestTokensAndGiveAllowance(
        nonDeployer,
        [token1, token2],
        metasoccerScouting.address,
        amountToMint
      );
      // Start scouting
      const r = mintAndScout(
        scouts,
        metasoccerScouting,
        nonDeployer,
        1,
        4,
        backend
      );
      // Check if user balance is down correctly
      await expect(r).not.to.be.reverted;
      const isOwner = await metasoccerScouting.isScoutingForAddress(
        nonDeployer.address,
        1
      );
      expect(isOwner).to.equal(true);
      const token1Balance = await token1.balanceOf(nonDeployer.address);
      const token2Balance = await token2.balanceOf(nonDeployer.address);
      expect(parseInt(formatUnits(token1Balance, 18))).to.equal(
        amountToMint - token1Price
      );
      expect(parseInt(formatUnits(token2Balance, 18))).to.equal(
        amountToMint - token2Price
      );

      expect(await token1.balanceOf(deployer.address)).to.equal(
        parseUnits(token1Price.toString(), 18)
      );

      expect(await token2.balanceOf(deployer.address)).to.equal(
        parseUnits(token2Price.toString(), 18)
      );
    });

    it("Scout should not be able to start scouting if user has not enough funds", async () => {
      const token1Price = 1000;
      const token2Price = 4000;
      const amountToMint = 500;

      const {
        scouts,
        nonDeployer,
        deployer,
        metasoccerScouting,
        token1,
        token2,
        backend,
      } = await waffle.loadFixture(fixtures);

      // Add payment tokens to scouting contract
      await setPrices(
        token1,
        token2,
        4,
        token1Price,
        token2Price,
        metasoccerScouting,
        deployer
      );
      // Give enough tokens to user

      await mintTestTokensAndGiveAllowance(
        nonDeployer,
        [token1, token2],
        metasoccerScouting.address,
        amountToMint
      );
      // Start scouting
      const r = mintAndScout(
        scouts,
        metasoccerScouting,
        nonDeployer,
        1,
        4,
        backend
      );

      await expect(r).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );
    });
  });

  describe("User should be able to cancel scouting and send again to claim players", () => {
    const scoutId = 1;
    const scoutLevel = 4;
    const token1Price = 1000;
    const token2Price = 4000;
    const amountToMint = 10000;

    let scouts: TestERC721;
    let token1: TestERC20;
    let token2: TestERC20;
    let metasoccerScouting: MetaSoccerScouting;
    let players: MetaSoccerPlayers;
    let deployer: SignerWithAddress;
    let nonDeployer: SignerWithAddress;
    let backend: SignerWithAddress;
    const level4NumberOfPlayers = 3;

    before(async () => {
      const loadedFixtures = await waffle.loadFixture(fixtures);
      scouts = loadedFixtures.scouts;
      token1 = loadedFixtures.token1;
      token2 = loadedFixtures.token2;
      metasoccerScouting = loadedFixtures.metasoccerScouting;
      players = loadedFixtures.players;
      deployer = loadedFixtures.deployer;
      nonDeployer = loadedFixtures.nonDeployer;
      backend = loadedFixtures.backend;
      await metasoccerScouting
        .connect(deployer)
        .setPlayersPerLevel(scoutLevel, level4NumberOfPlayers);

      // Add payment tokens to scouting contract
      await setPrices(
        token1,
        token2,
        scoutLevel,
        token1Price,
        token2Price,
        metasoccerScouting,
        deployer
      );
      // Give enough tokens to user

      await mintTestTokensAndGiveAllowance(
        nonDeployer,
        [token1, token2],
        metasoccerScouting.address,
        amountToMint
      );
      // Start scouting
      await mintAndScout(
        scouts,
        metasoccerScouting,
        nonDeployer,
        scoutId,
        scoutLevel,
        backend
      );
    });

    it("Owner should not transfer the scouting NFT using transferFrom", async () => {
      const tx = metasoccerScouting.transferFrom(
        nonDeployer.address,
        backend.address,
        scoutId
      );

      await expect(tx).to.revertedWith("Transferring Staked NFT");
    });

    it("Owner should not transfer the scouting NFT using safeTransferFrom", async () => {
      const tx = metasoccerScouting[
        "safeTransferFrom(address,address,uint256,bytes)"
      ](
        nonDeployer.address,
        backend.address,
        scoutId,
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      );

      await expect(tx).to.revertedWith("Transferring Staked NFT");
    });

    it("Non-owner should not be able to cancel scouting", async () => {
      const tx = metasoccerScouting.connect(deployer).forceWithdraw(scoutId);
      await expect(tx).to.be.revertedWith("Not Token Owner");
    });

    it("Admin should not be able to emergency withdraw properly staked scout", async () => {
      const tx = metasoccerScouting
        .connect(deployer)
        .withdrawNFT(scouts.address, scoutId);
      await expect(tx).to.be.revertedWith("Token can be withdrawn by owner");
    });

    it("Admin should not be able to emergency staking NFTs", async () => {
      const tx = metasoccerScouting
        .connect(deployer)
        .withdrawNFT(metasoccerScouting.address, scoutId);
      await expect(tx).to.be.revertedWith(
        "Withdrawing scouting NFTs not allowed"
      );
    });

    it("Owner should be able to cancel scouting", async () => {
      const tx = metasoccerScouting.connect(nonDeployer).forceWithdraw(scoutId);
      await expect(tx).to.emit(metasoccerScouting, "ScoutingCancelled");
      const ownerOfScoutingNFT = await metasoccerScouting.ownerOf(scoutId);
      const ownerOfScout = await scouts.ownerOf(scoutId);

      // Check owners
      expect(ownerOfScout).to.equal(nonDeployer.address);
      expect(ownerOfScoutingNFT).to.equal(metasoccerScouting.address);

      // Check scouting timestamps
      const scouting = await metasoccerScouting.scoutings(0);
      expect(scouting.timestamp).to.equal(0);
    });

    it("Owner can be able to send scout scouting after cancel scouting", async () => {
      const role = "Goalkeeper";
      const timestamp = getCurrentTimestampInSeconds() + 1000000;
      const signature = await getScoutingRequestSignature(
        metasoccerScouting,
        backend,
        scoutId,
        scoutLevel,
        role,
        timestamp
      );
      const tx = metasoccerScouting
        .connect(nonDeployer)
        .sendToScouting(
          scoutId,
          scoutLevel,
          role,
          scoutingPeriod,
          timestamp,
          signature
        );

      await expect(tx).to.emit(metasoccerScouting, "ScoutingStarted");
      const ownerOfScoutingNFT = await metasoccerScouting.ownerOf(scoutId);
      const ownerOfScout = await scouts.ownerOf(scoutId);

      // Check owners
      expect(ownerOfScoutingNFT).to.equal(nonDeployer.address);
      expect(ownerOfScout).to.equal(metasoccerScouting.address);

      // Check balances
      const token1Balance = await token1.balanceOf(nonDeployer.address);
      const token2Balance = await token2.balanceOf(nonDeployer.address);
      expect(parseInt(formatUnits(token1Balance, 18))).to.equal(
        amountToMint - token1Price * 2
      );
      expect(parseInt(formatUnits(token2Balance, 18))).to.equal(
        amountToMint - token2Price * 2
      );

      expect(await token1.balanceOf(deployer.address)).to.equal(
        parseUnits((token1Price * 2).toString(), 18)
      );

      expect(await token2.balanceOf(deployer.address)).to.equal(
        parseUnits((token2Price * 2).toString(), 18)
      );
    });

    it("Owner should not be able to finish scouting before scouting time", async () => {
      await expect(
        metasoccerScouting.connect(nonDeployer).finishScouting(scoutId)
      ).to.be.revertedWith("Scouting in progress");
    });

    it("Should return proper values in view functions", async () => {
      const length = await metasoccerScouting.getScoutingsLength();
      expect(length).to.equal(2);

      const scoutingsByOwnerLength =
        await metasoccerScouting.getScoutingsByOwnerLength(nonDeployer.address);
      expect(scoutingsByOwnerLength).to.equal(2);

      const scoutingsByScoutIdLength =
        await metasoccerScouting.getScoutingsByScoutIdLength(scoutId);
      expect(scoutingsByScoutIdLength).to.equal(2);

      const scoutingIdsByAddress =
        await metasoccerScouting.getScoutingIdsByAddress(nonDeployer.address);
      expect(scoutingIdsByAddress).to.deep.equal([
        BigNumber.from(0),
        BigNumber.from(1),
      ]);

      const scoutingIdsByScoutId =
        await metasoccerScouting.getScoutingIdsByScoutId(scoutId);
      expect(scoutingIdsByScoutId).to.deep.equal([
        BigNumber.from(0),
        BigNumber.from(1),
      ]);
    });

    it("Owner should be able to finish scouting after scouting time", async () => {
      await advanceToRewardTime(Date.now(), scoutingPeriod);
      await expect(
        metasoccerScouting.connect(nonDeployer).finishScouting(scoutId)
      ).to.emit(metasoccerScouting, "ScoutingFinished");
    });

    it("Admin should not be able to transfer user scouts", async () => {
      await expect(
        metasoccerScouting
          .connect(deployer)
          .withdrawNFT(scouts.address, scoutId)
      ).to.be.revertedWith("ERC721: transfer from incorrect owner");
    });

    it("Only scouting owner should not be able to claim players", async () => {
      const scoutingId = await metasoccerScouting.getLastScoutingIdByScoutId(
        scoutId
      );

      await expect(
        metasoccerScouting.connect(deployer).mintPlayers(scoutingId)
      ).to.be.revertedWith("Not Scouting Owner");
    });

    it("Owner should be able to claim players", async () => {
      const scoutingId = await metasoccerScouting.getLastScoutingIdByScoutId(
        scoutId
      );

      // Simulating VRF Callback
      await metasoccerScouting
        .connect(deployer)
        .setEntropy(
          scoutingId,
          0,
          BigNumber.from("1671210228694419150630361869718611530")
        );

      await metasoccerScouting.connect(nonDeployer).mintPlayers(scoutingId);
      expect(await players.balanceOf(nonDeployer.address)).to.equal(
        level4NumberOfPlayers
      );

      // Get entropy reverts if entropy does not exist
      await expect(players.getEntropy(0, 0)).not.to.be.reverted;
      await expect(players.getEntropy(0, 1)).not.to.be.reverted;

      const scoutingPlayers = await metasoccerScouting.getScoutingPlayerIds(
        scoutingId
      );

      expect(
        scoutingPlayers.map((id: BigNumber) => {
          return id.toNumber();
        })
      ).to.deep.equal([0, 1, 2]);
    });

    it("Owner should not be able to claim players twice", async () => {
      const scoutingId = await metasoccerScouting.getLastScoutingIdByScoutId(
        scoutId
      );

      await expect(
        metasoccerScouting.connect(nonDeployer).mintPlayers(scoutingId)
      ).to.be.revertedWith("Already claimed");
    });
  });

  describe("Only default admin role should be able to call methods protected with Admin role", () => {
    const scoutId = 1;
    const scoutLevel = 4;
    let scouts: TestERC721;
    let anotherNft: TestERC721;
    let metasoccerScouting: MetaSoccerScouting;
    let backend: SignerWithAddress;
    let nonDeployer: SignerWithAddress;
    let nonDeployer2: SignerWithAddress;
    let deployer: SignerWithAddress;
    let testERC20: TestToken;

    before(async () => {
      const loadedFixtures = await waffle.loadFixture(fixtures);
      scouts = loadedFixtures.scouts;
      anotherNft = loadedFixtures.anotherNft;
      metasoccerScouting = loadedFixtures.metasoccerScouting;
      backend = loadedFixtures.backend;
      nonDeployer = loadedFixtures.nonDeployer;
      nonDeployer2 = loadedFixtures.nonDeployer2;
      deployer = loadedFixtures.deployer;
      testERC20 = loadedFixtures.token1;

      await mintAndScout(
        scouts,
        metasoccerScouting,
        nonDeployer,
        scoutId,
        scoutLevel,
        backend
      );
    });

    it("Only admin should be able to withdraw an scout transferred forcefully to scouting contract", async () => {
      // We mint and send scout directly to scouting contract
      await scouts.connect(deployer).mint(nonDeployer2.address, 2);
      await scouts
        .connect(nonDeployer2)
        .transferFrom(nonDeployer2.address, metasoccerScouting.address, 2);

      const nonAdminTx = metasoccerScouting
        .connect(nonDeployer)
        .withdrawNFT(scouts.address, 2);

      await expect(nonAdminTx).to.be.reverted;

      await metasoccerScouting.connect(deployer).withdrawNFT(scouts.address, 2);
      expect(await scouts.ownerOf(2)).to.be.equal(deployer.address);
    });

    it("Only admin should be able to withdraw an NFT sent to scouting contract", async () => {
      // We mint and send scout directly to scouting contract
      await anotherNft.connect(deployer).mint(nonDeployer2.address, 2);
      await anotherNft
        .connect(nonDeployer2)
        .transferFrom(nonDeployer2.address, metasoccerScouting.address, 2);

      const nonAdminTx = metasoccerScouting
        .connect(nonDeployer)
        .withdrawNFT(anotherNft.address, 2);

      await expect(nonAdminTx).to.be.reverted;

      await metasoccerScouting
        .connect(deployer)
        .withdrawNFT(anotherNft.address, 2);
      expect(await anotherNft.ownerOf(2)).to.be.equal(deployer.address);
    });

    it("Only admin should be able to withdraw an ERC20 sent to scouting contract", async () => {
      // We mint and send scout directly to scouting contract
      await testERC20.connect(deployer).mint(nonDeployer2.address, 1000000);
      await testERC20
        .connect(nonDeployer2)
        .transfer(metasoccerScouting.address, 1000000);

      const nonAdminTx = metasoccerScouting
        .connect(nonDeployer)
        .withdrawERC20(testERC20.address, 1000000);

      await expect(nonAdminTx).to.be.reverted;

      await metasoccerScouting
        .connect(deployer)
        .withdrawERC20(testERC20.address, 1000000);
      expect(await testERC20.balanceOf(deployer.address)).to.be.equal(1000000);
    });

    it("Only admin should be able to pause", async () => {
      const pause = true;
      const nonAdminTx = metasoccerScouting
        .connect(nonDeployer)
        .setPause(pause);
      await expect(nonAdminTx).to.be.reverted;

      await metasoccerScouting.connect(deployer).setPause(pause);
      expect(await metasoccerScouting.paused()).to.be.equal(pause);
    });

    it("Only admin should be able to unpause", async () => {
      const pause = false;
      const nonAdminTx = metasoccerScouting
        .connect(nonDeployer)
        .setPause(pause);
      await expect(nonAdminTx).to.be.reverted;

      await metasoccerScouting.connect(deployer).setPause(pause);
      expect(await metasoccerScouting.paused()).to.be.equal(pause);
    });

    it("Only admin should be able to set entropy manager", async () => {
      const entropyManager2 = "0x29D7d1dd5B6f9C864d9db560D72a247c178aE86B";
      const nonAdminTx = metasoccerScouting
        .connect(nonDeployer)
        .setEntropyManager(entropyManager2);
      await expect(nonAdminTx).to.be.reverted;

      const zeroTx = metasoccerScouting
        .connect(deployer)
        .setEntropyManager("0x0000000000000000000000000000000000000000");

      await expect(zeroTx).to.be.revertedWith("Invalid Address");

      await metasoccerScouting
        .connect(deployer)
        .setEntropyManager(entropyManager2);
      const currentEntropyManager = await metasoccerScouting.entropyManager();
      expect(currentEntropyManager).to.equal(entropyManager2);
    });
  });

  describe("View functions", () => {
    it("Should support 721 Enumerable interface", async () => {
      const { metasoccerScouting } = await waffle.loadFixture(fixtures);
      expect(await metasoccerScouting.supportsInterface("0x780e9d63")).to.equal(
        true
      );
    });
  });
});
