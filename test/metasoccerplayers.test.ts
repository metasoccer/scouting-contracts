import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { ethers, waffle, artifacts } from "hardhat";

import { MetaSoccerPlayers } from "../typechain-types";

describe("MetaSoccerPlayer", function () {
  let players: MetaSoccerPlayers;
  let admin: SignerWithAddress;
  let dnaRole: SignerWithAddress;
  let attributesRole: SignerWithAddress;
  let noRole: SignerWithAddress;
  let idGenerator: MockContract;
  let idGenerator2: MockContract;
  let tokenId: number = 0;

  before(async () => {
    [admin, dnaRole, attributesRole, noRole] = await ethers.getSigners();
    const p = await waffle.deployMockContract(
      admin,
      artifacts.readArtifactSync("EntropyManager").abi
    );
    idGenerator = await waffle.deployMockContract(
      admin,
      artifacts.readArtifactSync("PlayersIdGenerator").abi
    );
    await idGenerator.mock.getPlayerId.returns(tokenId);

    idGenerator2 = await waffle.deployMockContract(
      admin,
      artifacts.readArtifactSync("PlayersIdGenerator").abi
    );
    await idGenerator.mock.getPlayerId.returns(tokenId);
    p.mock.requestEntropy.returns();

    const playerFactory = await ethers.getContractFactory("MetaSoccerPlayers");
    players = await playerFactory.deploy(
      "Ms Player",
      "MSP",
      idGenerator.address
    );
    await players.grantRole(await players.MINTER_ROLE(), admin.address);
    await players.grantRole(await players.SET_DNA_ROLE(), dnaRole.address);
    await players.grantRole(
      await players.SET_ATTRIBUTES_ROLE(),
      attributesRole.address
    );
  });

  async function increaseTokenId() {
    tokenId += 1;
    await idGenerator.mock.getPlayerId.returns(tokenId);
  }

  beforeEach(async () => {
    await increaseTokenId();
  });

  describe("mintPlayer", () => {
    it("Should support 721 Enumerable interface", async () => {
      expect(await players.supportsInterface("0x780e9d63")).to.equal(true);
    });

    it("Should revert properly if role is missing", async function () {
      const noRoleSigner = (await ethers.getSigners())[1];
      const e = players.connect(noRoleSigner).mintPlayer(admin.address, 1, 0);
      await expect(e).to.be.revertedWith(
        `AccessControl: account ${noRoleSigner.address.toLowerCase()}`
      );
    });

    it("Should revert on invalid address", async function () {
      const addr = "0x0000000000000000000000000000000000000000";
      const e = players.mintPlayer(addr, 1, 0);
      await expect(e).to.be.revertedWith("Invalid owner address");
    });

    it("Should revert if minting twice the same token", async function () {
      await players.mintPlayer(admin.address, 1, 0);
      const e = players.mintPlayer(admin.address, 1, 0);
      expect(e).to.be.revertedWith("ERC721: token already minted");
    });

    it("Should not revert if everything is in order", async function () {
      const e = players.mintPlayer(admin.address, 1, 0);
      expect(e).to.not.be.reverted;
    });

    it("Should save the origin of the token", async function () {
      const minterTypeNumber = 1;
      await players.mintPlayer(admin.address, minterTypeNumber, tokenId);
      const [minterType, minterId] = await players.getTokenOrigin(tokenId);
      expect(minterType).to.be.equal(minterTypeNumber);
      expect(minterId).to.be.equal(tokenId);
    });

    it("Should track existance", async function () {
      await players.mintPlayer(admin.address, 1, 0);
      expect(await players.exists(tokenId)).to.equal(true);
    });

    it("Should return the IDs of the owned tokens", async function () {
      const redeemerTId1 = tokenId;
      await players.mintPlayer(admin.address, 1, 0);

      await increaseTokenId();
      const redeemerTId2 = tokenId;
      await players.mintPlayer(admin.address, 1, 0);

      await increaseTokenId();
      const redeemerTId3 = tokenId;
      await players.mintPlayer(admin.address, 1, 0);

      const getOwnedTokenIds = await players.getOwnedTokenIds(admin.address);
      expect(getOwnedTokenIds.map((el) => el.toNumber())).to.be.include.members(
        [redeemerTId1, redeemerTId2, redeemerTId3]
      );
    });

    it("Only owner should be able to burn token", async () => {
      await players.connect(admin).mintPlayer(noRole.address, 1, 0);
      const adminTx = players.connect(admin).burnToken(tokenId);
      await expect(adminTx).to.be.revertedWith(
        "Sender is not owner nor approved"
      );

      const ownerTx = players.connect(noRole).burnToken(tokenId);
      await expect(ownerTx).not.be.reverted;
    });
  });

  describe("view functions", () => {
    it("metadata uri", async () => {
      const uri = await players.metadata_uri();
      const metadataURI = await players.tokenURI(tokenId);
      expect(metadataURI).to.equal(uri + "/" + tokenId);
    });

    it("contract uri", async () => {
      const uri = await players.metadata_uri();
      const contractUri = await players.contractURI();
      expect(contractUri).to.equal(uri);
    });
  });

  describe("contract roles", () => {
    it("Only SET_DNA_ROlE should be able to set DNA", async () => {
      const dna = "RANDOM_DNA";
      const noDNARoleTx = players.connect(noRole).setDNA(tokenId, dna);
      await expect(noDNARoleTx).to.be.revertedWith(
        `AccessControl: account ${noRole.address.toLowerCase()}`
      );

      const DNARoleTx = players.connect(dnaRole).setDNA(tokenId, dna);
      await expect(DNARoleTx).not.be.reverted;

      const DNARoleTx2 = players.connect(dnaRole).setDNA(tokenId, dna);
      await expect(DNARoleTx2).to.be.revertedWith("DNA already exists");
    });

    it("Only SET_ATTRIBUTES_ROLE should be able to set attributes", async () => {
      const attribute = "AMAZING_ATTRIBUTE";
      const value = "Super High";

      const noAttributesRoleTx = players
        .connect(noRole)
        .setAttribute(tokenId, attribute, value);
      await expect(noAttributesRoleTx).to.be.revertedWith(
        `AccessControl: account ${noRole.address.toLowerCase()}`
      );

      const attributesRoleTx = players
        .connect(attributesRole)
        .setAttribute(tokenId, attribute, value);
      await expect(attributesRoleTx).not.be.reverted;
    });

    it("Only admin should be able to set metadata uri", async () => {
      const metadataUri = "https://example.com";

      const noAdminRoleTx = players.connect(noRole).setMetadataURI(metadataUri);
      await expect(noAdminRoleTx).to.be.revertedWith(
        `AccessControl: account ${noRole.address.toLowerCase()}`
      );

      const adminRoleTx = players.connect(admin).setMetadataURI(metadataUri);
      await expect(adminRoleTx).not.be.reverted;
    });

    it("Only admin should be able to set id generator", async () => {
      const noAdminRoleTx = players
        .connect(noRole)
        .setIdGenerator(idGenerator2.address);
      await expect(noAdminRoleTx).to.be.revertedWith(
        `AccessControl: account ${noRole.address.toLowerCase()}`
      );

      const adminRoleTx = players
        .connect(admin)
        .setIdGenerator(idGenerator2.address);
      await expect(adminRoleTx).not.be.reverted;
    });
  });
});
