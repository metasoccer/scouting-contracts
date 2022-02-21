import { expect } from "chai";
import { ethers } from "hardhat";
import { PlayersIdGenerator } from "../typechain-types";

describe("PlayersIdGenerator", function () {
  let idGenerator: PlayersIdGenerator;

  before(async () => {
    const playerIdGeneratorFactory = await ethers.getContractFactory(
      "PlayersIdGenerator"
    );
    idGenerator = await playerIdGeneratorFactory.deploy();
  });

  describe("getPlayerId", () => {
    it("Should revert properly if type does not exists", async function () {
      const e = idGenerator.getPlayerId(255, 1, 100);
      await expect(e).to.be.revertedWith("Invalid minter");
    });

    it("Should return tokens total supply as id", async () => {
      const totalSupply = 1000;
      const id = await idGenerator.getPlayerId(0, 1, totalSupply);
      expect(id.toNumber()).to.equal(totalSupply);
    });
  });

  describe("typeBounds", () => {
    it("Should return the types bound", async function () {
      const e = await idGenerator.typeBounds();
      expect(e).to.be.an("array").that.is.not.empty;
      expect(e[1].toNumber()).is.greaterThanOrEqual(e[0].toNumber());
    });
  });

  describe("typeName", () => {
    it("Should return the types name", async function () {
      const e = await idGenerator.typeName(0);
      expect(e).to.be.equal("Scouting");
    });
    it("Should revert with Not existing", async function () {
      const e = idGenerator.typeName(1);
      await expect(e).to.be.revertedWith("Not existing");
    });
  });
});
