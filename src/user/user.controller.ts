import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/auth/auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';
import { UserId } from './userId.decorator';

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('users/login')
  async login(@Body() loginDto: LoginDto) {
    return await this.userService.login(loginDto.user);
  }

  @Post('users')
  async signup(@Body() createUserDto: CreateUserDto) {
    return await this.userService.signup(createUserDto.user);
  }

  @UseGuards(AuthGuard)
  @Get('user')
  async getCurrentUser(@UserId() userId: string) {
    return await this.userService.getById(userId);
  }

  @UseGuards(AuthGuard)
  @Put('user')
  async updateUser(
    @Body() updateUserDto: UpdateUserDto,
    @UserId() userId: string,
  ) {
    return await this.userService.update(userId, updateUserDto.user);
  }
}
