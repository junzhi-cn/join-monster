import bcryptjs from 'bcryptjs';
import { PubSub } from 'graphql-subscriptions';
import _ from 'lodash';
import joinMonster from 'join-monster';

import { requiresAuth, requiresAdmin } from './permissions';
import { refreshTokens, tryLogin } from './auth';

export const pubsub = new PubSub();

const USER_ADDED = 'USER_ADDED';

export default {
  Subscription: {
    userAdded: {
      subscribe: () => pubsub.asyncIterator(USER_ADDED),
    },
  },
  User: {
    boards: ({ id }, args, { models }) =>
      models.Board.findAll({
        where: {
          owner: id,
        },
      }),
    suggestions: ({ id }, args, { models }) =>
      models.Suggestion.findAll({
        where: {
          creatorId: id,
        },
      }),
  },
  Board: {
    suggestions: ({ id }, args, { suggestionLoader }) => suggestionLoader.load(id),
  },
  Suggestion: {
    creator: ({ creatorId }, args, { models }) =>
      models.User.findOne({
        where: {
          id: creatorId,
        },
      }),
  },
  Query: {
    allAuthors: (parent, args, { models }, info) =>
      joinMonster(info, args, sql =>
        models.sequelize.query(sql, { type: models.sequelize.QueryTypes.SELECT }),
      ),
    getBook: (parent, args, { models }, info) =>
      joinMonster(info, args, sql =>
        models.sequelize.query(sql, { type: models.sequelize.QueryTypes.SELECT }),
      ),
    allBooks: (parent, args, { models }, info) =>
      joinMonster(info, args, sql =>
        models.sequelize.query(sql, { type: models.sequelize.QueryTypes.SELECT }),
      ),
    suggestions: (parent, args, { models }) => models.Suggestion.findAll(),
    someSuggestions: (parent, args, { models }) => models.Suggestion.findAll(args),
    someSuggestions2: (parent, { limit, cursor }, { models }) =>
      models.Suggestion.findAll({
        limit,
        where: {
          id: {
            $gt: cursor || -1,
          },
        },
        order: ['id'],
      }),
    searchSuggestions: (parent, { query, limit, cursor }, { models }) =>
      models.Suggestion.findAll({
        limit,
        where: {
          text: {
            $iLike: `%${query}%`,
          },
          id: {
            $gt: cursor || -1,
          },
        },
        order: ['id'],
      }),
    allUsers: requiresAuth.createResolver((parent, args, { models }) => models.User.findAll()),
    me: (parent, args, { models, user }) => {
      if (user) {
        // they are logged in
        return models.User.findOne({
          where: {
            id: user.id,
          },
        });
      }
      // not logged in user
      return null;
    },
    userBoards: (parent, { owner }, { models }) =>
      models.Board.findAll({
        where: {
          owner,
        },
      }),
    userSuggestions: (parent, { creatorId }, { models }) =>
      models.Suggestion.findAll({
        where: {
          creatorId,
        },
      }),
  },

  Mutation: {
    updateUser: (parent, { username, newUsername }, { models }) =>
      models.User.update({ username: newUsername }, { where: { username } }),
    deleteUser: (parent, args, { models }) => models.User.destroy({ where: args }),
    createBoard: (parent, args, { models }) => models.Board.create(args),
    createSuggestion: (parent, args, { models }) => models.Suggestion.create(args),
    createUser: async (parent, args, { models }) => {
      const user = args;
      user.password = 'idk';
      const userAdded = await models.User.create(user);
      pubsub.publish(USER_ADDED, {
        userAdded,
      });
      return userAdded;
    },
    register: async (parent, args, { models }) => {
      const user = _.pick(args, ['username', 'isAdmin']);
      const localAuth = _.pick(args, ['email', 'password']);
      const passwordPromise = bcryptjs.hashSync(localAuth.password, bcryptjs.genSaltSync(12));
      const createUserPromise = models.User.create(user);
      const [password, createdUser] = await Promise.all([passwordPromise, createUserPromise]);
      localAuth.password = password;
      return models.LocalAuth.create({
        ...localAuth,
        user_id: createdUser.id,
      });
    },
    login: async (parent, { email, password }, { models, SECRET }) =>
      tryLogin(email, password, models, SECRET),
    refreshTokens: (parent, { token, refreshToken }, { models, SECRET }) =>
      refreshTokens(token, refreshToken, models, SECRET),
    createBook: async (parent, args, { models }) => {
      const book = await models.Book.create(args);
      return {
        ...book.dataValues,
        authors: [],
      };
    },
    createAuthor: async (parent, args, { models }) => {
      const author = await models.Author.create(args);
      return {
        ...author.dataValues,
        books: [],
      };
    },
    addBookAuthor: async (parent, args, { models }) => {
      await models.BookAuthor.create(args);
      return true;
    },
  },
};
