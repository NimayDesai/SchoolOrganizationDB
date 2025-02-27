import { User } from "../entities/User";
import {
  Arg,
  Ctx,
  Field,
  FieldResolver,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
  Root,
  UseMiddleware,
} from "type-graphql";
import argon2 from "argon2";
import { MyContext } from "../types";
import { isAuth } from "../middleware/isAuth";
import { validateChangeInfo } from "../utils/valdiateChangeInfo";
import dataSource from "../db.config";
import { validateRegister } from "../utils/validateRegister";
import { sendEmail } from "../utils/sendEmail";
import { v4 } from "uuid";
import { FORGET_PASSWORD_PREFIX } from "../constants";

// Input for Login
@InputType()
class UsernamePasswordEmailInput {
  @Field()
  usernameOrEmail: string;
  @Field()
  password: string;
}

// Input for change INfo
@InputType()
export class ChangeInfoInput {
  @Field(() => String, { nullable: true })
  username?: string;
  @Field(() => String, { nullable: true })
  email?: string;
  @Field(() => String, { nullable: true })
  password?: string;
  @Field(() => String, { nullable: true })
  confirmPassword?: string;
}

@InputType()
export class RegisterInput {
  @Field()
  username: string;
  @Field()
  email: string;
  @Field()
  password: string;
  @Field()
  confirmPassword: string;
}
// Returns a field that displays the field and message which displays the error
@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
}

// Add user id to express-session
declare module "express-session" {
  export interface SessionData {
    user: { [key: string]: any };
    userId: number;
  }
}

// Returns a list of FieldErrors or a user
@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[] | null;

  @Field(() => User, { nullable: true })
  user?: User | null;
}

@Resolver(User)
export class UserResolver {
  // Uploads an image based on the passed imageUrl
  @Mutation(() => UserResponse)
  async uploadImg(
    @Ctx() { req }: MyContext,
    @Arg("imageUrl", () => String) imageUrl: string
  ): Promise<UserResponse> {
    // Get userId from the session
    const userId = req.session.userId;
    // Update the User based on the new ID
    await User.update({ id: userId }, { imageUrl });
    // Refetch the user to return
    const user = await User.findOne({ where: { id: userId } });
    return { user }; // Return the user
  }
  @Query(() => User)
  async getUser(@Arg("id", () => Int) id: number): Promise<User | null> {
    const user = await dataSource
      .getRepository(User)
      .findOne({ where: { id } });
    if (!user) {
      return null;
    } else {
      return user;
    }
  }

  @Mutation(() => UserResponse)
  async changePassword(
    @Arg("token") token: string,
    @Arg("newPassword") newPassword: string,
    @Arg("confirmNewPassword") confirmNewPassword: string,
    @Ctx() { req, redis }: MyContext
  ): Promise<UserResponse> {
    if (newPassword!.length <= 2) {
      // Password is too short
      return {
        errors: [
          {
            field: "newPassword",
            message: "Length Must be greater than 2",
          },
        ],
      };
    }
    if (newPassword !== confirmNewPassword) {
      // Password and confirm Password are not equal
      return {
        errors: [
          {
            field: "confirmNewPassword",
            message: "Passwords do not match",
          },
        ],
      };
    }

    // Get the redis key and userid
    const redisKey = FORGET_PASSWORD_PREFIX + token;
    const userId = await redis.get(redisKey);

    // Invalid token (expired on user tampered with the URL)
    if (!userId) {
      return {
        errors: [
          {
            field: "token",
            message: "Invalid Token",
          },
        ],
      };
    }

    // The userId as a number
    const userIdNumber = parseInt(userId);
    // Find a user
    const user = await User.findOne({ where: { id: userIdNumber } });

    // User was deleted
    if (!user) {
      return {
        errors: [
          {
            field: "token",
            message: "User no longer exists",
          },
        ],
      };
    }

    // Update the user with the new password
    await User.update(
      { id: userIdNumber },
      {
        password: await argon2.hash(newPassword),
      }
    );

    await redis.del(redisKey);

    req.session.userId = user.id;

    return { user };
  }
  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg("email") email: string,
    @Ctx() { redis }: MyContext
  ): Promise<boolean> {
    // Find a user
    const user = await User.findOne({ where: { email } });

    // If there is no user return true (we do not want the user to know if which email is related to a user)
    if (!user) {
      return true;
    }
    // Get the uuid token

    const token = v4();

    // Set the token to the token
    await redis.set(
      FORGET_PASSWORD_PREFIX + token,
      user.id,
      "EX",
      1000 * 60 * 60 * 24 * 3
    );

    // Send the user a link to reset their password
    const html = `
    <div>
    <div>
    <h2>Hello ${user.username}</h2>
    <p>Below is a link to reset your password</p>
    <a href="https://peeldb.me/change-password/${token}">Reset Password</a>
    </div></div>
    `;

    await sendEmail(email, html);
    return true;
  }
  @Query(() => Int)
  async countUsers(): Promise<number> {
    return dataSource.getRepository(User).createQueryBuilder("u").getCount(); // Get the count of how many users are there
  }
  @UseMiddleware(isAuth) // Check if the user is logged in
  @Mutation(() => UserResponse)
  async changeInfo(
    @Arg("input") input: ChangeInfoInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const errors = validateChangeInfo(input); // Validate the user input
    if (errors) {
      // Return errors if there are any errors
      return errors;
    }

    const userId = req.session.userId; // Get the user id from the currently logged in user

    let user: User | null = await User.findOne({ where: { id: userId } }); // Find a user based on the userId

    try {
      await User.update(
        // Update the user
        { id: userId },
        {
          password: input.password
            ? await argon2.hash(input.password) // Only update if given
            : user?.password,
          username: input.username ? input.username : user?.username,
          email: input.email ? input.email : user?.email,
        }
      );
    } catch (err) {
      if (err.code === "23505") {
        // User already exists (dupliate key error)
        return {
          errors: [
            {
              field: "username",
              message: "School Already Exists",
            },
          ],
        };
      }
    }
    user = await User.findOne({ where: { id: userId } }); // Refetch the new user

    return { user }; // Return the user
  }

  @FieldResolver(() => String)
  email(@Root() user: User, @Ctx() { req }: MyContext) {
    if (req.session.userId === user.id) {
      // If the user viewing the email is the same user whose email it is
      return user.email; // It is ok for the user to see their own email
    }

    return ""; // If not return an empty string
  }
  // Finds the currently logged in user
  @Query(() => User, { nullable: true })
  async me(@Ctx() { req }: MyContext): Promise<User | null> {
    if (!req.session.userId) {
      // If the user isnt logged in return null
      return null;
    }

    const user = await User.findOne({ where: { id: req.session.userId } }); // Find the currently logged in user
    return user; // Return the user
  }
  // Creates a new user
  @Mutation(() => UserResponse)
  async register(
    @Arg("options") options: RegisterInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const errors = validateRegister(options); // Validate Input
    if (errors) {
      // If errors return the errors
      return errors;
    }
    const hashedPassword = await argon2.hash(options.password); // Store the hashedPassword in the DB
    const user = User.create({
      // Create a new user in the DB with the options specified
      username: options.username,
      password: hashedPassword,
      email: options.email,
    });
    try {
      // Try to create a user
      await user.save();
    } catch (err) {
      if (err.code === "23505") {
        // User already exists (duplicate key error)
        return {
          errors: [
            {
              field: "username",
              message: "School Already Exists",
            },
          ],
        };
      }
    }

    req.session.userId = user.id; // Automatically Log in the User
    return {
      user,
    };
  }
  @Mutation(() => UserResponse)
  async login(
    @Arg("options") options: UsernamePasswordEmailInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const user = await User.findOne({
      // If userNameOrEmail includes an at-sign assume its an email otherwise assume its a username
      where: options.usernameOrEmail.includes("@")
        ? { email: options.usernameOrEmail }
        : { username: options.usernameOrEmail },
    });
    if (!options.usernameOrEmail) {
      return {
        errors: [
          {
            field: "usernameOrEmail",
            message: "No username or email supplied",
          },
        ],
      };
    }
    if (!options.password) {
      return {
        errors: [
          {
            field: "password",
            message: "No password supplied",
          },
        ],
      };
    }
    if (!user) {
      // No user with the specified Username or Email
      return {
        errors: [
          {
            field: "usernameOrEmail",
            message: "That School does not exist",
          },
        ],
      };
    }
    const valid = await argon2.verify(user.password, options.password);
    if (!valid) {
      // Invalid Password
      return {
        errors: [
          {
            field: "password",
            message: "Invalid password",
          },
        ],
      };
    }

    // Login in the user by storing a cookie
    req.session!.userId = user.id;
    return {
      user,
    };
  }
  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext): Promise<boolean> {
    return new Promise((resolve) => {
      req.session.destroy((err) => {
        // Destroy the redis session
        res.clearCookie(process.env.COOKIE_NAME); // Destory the cookie
        if (err) {
          resolve(false);
          return;
        }

        resolve(true);
      });
    });
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async deleteUser(@Ctx() { req, res }: MyContext): Promise<boolean> {
    await User.delete({ id: req.session.userId });
    return new Promise((resolve) => {
      req.session.destroy((err) => {
        res.clearCookie(process.env.COOKIE_NAME);
        if (err) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }
}
