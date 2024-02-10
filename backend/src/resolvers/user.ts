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

@InputType()
class UsernamePasswordEmailInput {
  @Field()
  usernameOrEmail: string;
  @Field()
  password: string;
}

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
@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
}

declare module "express-session" {
  export interface SessionData {
    user: { [key: string]: any };
    userId: number;
  }
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => User, { nullable: true })
  user?: User;
}

@Resolver(User)
export class UserResolver {
  @Query(() => Int)
  async countUsers() {
    return dataSource.getRepository(User).createQueryBuilder("u").getCount();
  }
  @UseMiddleware(isAuth)
  @Mutation(() => UserResponse)
  async changeInfo(
    @Arg("input") input: ChangeInfoInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const errors = validateChangeInfo(input);
    if (errors) {
      return errors;
    }

    const userId = req.session.userId;

    let user = await User.findOne({ where: { id: userId } });

    try {
      await User.update(
        { id: userId },
        {
          password: input.password
            ? await argon2.hash(input.password)
            : user.password,
          username: input.username ? input.username : user.username,
          email: input.email ? input.email : user.email,
        }
      );
    } catch (err) {
      if (err.code === "23505") {
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
    user = await User.findOne({ where: { id: userId } });

    return { user };
  }

  @FieldResolver(() => String)
  email(@Root() user: User, @Ctx() { req }: MyContext) {
    if (req.session.userId === user.id) {
      return user.email;
    }

    return "";
  }
  @Query(() => User, { nullable: true })
  async me(@Ctx() { req }: MyContext) {
    if (!req.session.userId) {
      return null;
    }

    const user = await User.findOne({ where: { id: req.session.userId } });
    return user;
  }
  @Mutation(() => UserResponse)
  async register(
    @Arg("options") options: RegisterInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    if (options.username.length <= 2) {
      return {
        errors: [
          {
            field: "username",
            message: "Length must be greater than 2",
          },
        ],
      };
    }
    if (!options.email.includes("@")) {
      return {
        errors: [
          {
            field: "email",
            message: "Email must include at sign",
          },
        ],
      };
    }
    if (options.password.length <= 2) {
      return {
        errors: [
          {
            field: "password",
            message: "Length Must be greater than 2",
          },
        ],
      };
    }
    if (options.password !== options.confirmPassword) {
      return {
        errors: [
          {
            field: "confirmPassword",
            message: "Passwords do not match",
          },
        ],
      };
    }

    if (options.username.includes("@")) {
      return {
        errors: [
          {
            field: "username",
            message: "Username cannot include at sign",
          },
        ],
      };
    }
    const hashedPassword = await argon2.hash(options.password);
    const user = User.create({
      username: options.username,
      password: hashedPassword,
      email: options.email,
    });
    try {
      await user.save();
    } catch (err) {
      if (err.code === "23505") {
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

    req.session.userId = user.id;
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
      where: options.usernameOrEmail.includes("@")
        ? { email: options.usernameOrEmail }
        : { username: options.usernameOrEmail },
    });
    if (!user) {
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
      return {
        errors: [
          {
            field: "password",
            message: "Invalid password",
          },
        ],
      };
    }

    req.session!.userId = user.id;
    return {
      user,
    };
  }
  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) => {
      req.session.destroy((err) => {
        res.clearCookie("qid");
        if (err) {
          resolve(false);
          return;
        }

        resolve(true);
      });
    });
  }
}
